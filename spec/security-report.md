# Sprint 8 セキュリティ監査レポート（人材基盤: talent）

**監査者:** ⑪ Security Engineer 鍵山 剛　**日付:** 2026-11-08　**対象:** ブランチ `feat/talent-foundation`（`origin/main...HEAD`）、spec/behavioral-spec.md 追補 v2.23
**対象物:** `packages/input-core/src/talent/{model,eligibility,renewal}.ts`、`supabase/migrations/0410〜0418`、`supabase/tests/{run_talent_rls_check.sh,talent_rls_check.sql}`

## 結論

| Severity | 件数 | Finding |
|---|---|---|
| Critical（9.0〜10.0） | **0** | — |
| High（7.0〜8.9） | **2** | SEC-001（8.2）、SEC-002（7.1） |
| Medium（4.0〜6.9） | **11** | SEC-003（6.5）、SEC-004（6.5）、SEC-005（6.5）、SEC-006（5.4）、SEC-007（5.3）、SEC-008（5.3）、SEC-009（4.9）、SEC-010（4.3）、SEC-011（4.4）、SEC-012（4.7）、SEC-014（4.3） |
| Low（0.1〜3.9） | **4** | SEC-013（3.3）、SEC-015（3.1）、SEC-016（3.1）、SEC-017（3.1） |

**判定:** 基盤層（画面・API が無い現状）としては、**会社間・グループ間のデータ分離は破れなかった**（攻撃 40 件超のうち越境は 0 件。第3章）。一方、**High が 2 件（SEC-001 TRUNCATE、SEC-002 応募テーブルの直接書込）ある。TRAID の Gate 3（Critical 0 件 / High 0 件）は不合格。** 両者とも仕様に既知のリスク（KR-4、KR-1）として明記済みだが、実測すると影響は文書の想定より大きい（SEC-001 は TRUNCATE CASCADE で全会社の staff・shifts・jyoban_* まで消えた）。

**最重要:** SEC-001（全テナントの一括消去）と SEC-002（同意・決定者・労働条件通知の偽装と、確定済みの記録の削除）。どちらも Sprint 9 で画面・API を公開する前に塞ぐ。

### 公開前の必須条件（画面・API・本番データの投入の前に満たすこと）

1. **SEC-001**（High 8.2）TRUNCATE ... CASCADE で全テナントの人・雇用・案件を一括消去できる（KR-4 の実測。影響は想定より広い）
2. **SEC-002**（High 7.1）会社管理者が job_applications を直接書き換え・削除でき、同意・決定者・労働条件通知の記録を偽装できる（KR-1 の実測）
3. **SEC-003**（Medium 6.5）会社に属する全ロールが、自社の全員の生年月日・電話・メール・在留情報を読め、候補検索も呼べる（KR-5 / OQ-22 / OQ-19 / OQ-20）
4. **SEC-004**（Medium 6.5）checkEligibility が入力件数に対し 2 乗時間で、数千件のシフトでサーバを数十秒止められる
5. **SEC-005**（Medium 6.5）警備・線引き・派遣の統制が、案件を作る会社自身の自己申告（職種の選択・needs_boundary_check・確認者の文字列）で回避できる（KR-3 / OQ-21）
6. **SEC-006**（Medium 5.4）監査証跡が無い: 同意の変更・PII の参照・候補検索が記録されず、created_by / decided_by / boundary_confirmed_by は自己申告の文字列
7. **SEC-007**（Medium 5.3）checkEligibility / listRenewals が実行時に型を検証せず、"false"（文字列）の同意・在留可否が真として扱われ、null で TypeError になる
8. **SEC-008**（Medium 5.3）staff.person_id が雇用先の会社のグループと一致するかを DB が検査せず、候補検索の id で他人の PII 全項目を読める経路になる
9. **SEC-009**（Medium 4.9）共同利用の同意の記録が仕様に足りず、改ざん・前倒し・代理記録が DB で止まらない（OQ-12a/b/c、個人情報保護法 第27条第5項第3号）

加えて、運用条件として次を満たす。
- 画面・API から `job_applications` に書き込む機能は、SEC-002 の権限取消と RPC 化が済むまで公開しない（KR-1 の記載どおり）。
- OQ-12a（共同利用の項目）・OQ-12b（書面の扱い）・OQ-12c（通知文と版）を弁護士の確認で確定し、責任者（氏名または名称）の公表場所を決めるまで、既存スタッフの同意の取得（REQ-035b）と共同利用の運用を開始しない（SEC-009）。
- OQ-22（候補検索・PII の参照ロール）、OQ-19/OQ-20（支店・本社の範囲）を決め、REQ-040 の許可表を DB の権限に反映するまで、persons を画面に出さない（SEC-003）。
- OQ-16（エンゲージ・タウンワークの応募取り込み）は未実装のため Finding は無いが、**外部由来の個人情報の取り込み口**になる。取り込み実装の前に、入力検証（CSV/メールの数式・制御文字・巨大ファイル）、取り込み元の認証と許可リスト、取り込んだ PII の同意・保存期間の扱いを設計して再監査する。
- 依存関係の High（SEC-012）は、Gate 3 が推移的依存も 0 件を要求するため、Evaluator が環境値（開発時のみ）を認めるか、overrides で解消するかを決める。

## 1. 監査範囲と方法

| 観点 | 方法 |
|---|---|
| A01 アクセス制御 | 使い捨て Postgres 16 に本番と同じ連鎖（0000, 0100, 0102, 0103, 0200〜0202, 0400〜0402, 0406〜0418。0300 の一部も適用）を適用し、Supabase 既定相当の権限（anon/authenticated に ALL、新関数に既定の EXECUTE）で、A1社・A2社（同グループ）・B1社（別グループ）の管理者、role=staff の利用者、会社なしの利用者、プロフィールなしの利用者、anon、運営として攻撃を実行 |
| A02 暗号化 | 列の保存形式の確認（`information_schema.columns`）。通信・ディスクの暗号化は Supabase の責務として対象外 |
| A03 インジェクション | SECURITY DEFINER 関数 8 本（0411〜0418）の search_path・動的 SQL を精査。動的 SQL は 0410 の `DO` ブロックの `format('%I')` のみで、識別子は固定配列 |
| A04 安全でない設計 | 同意なしの人の漏えい経路、他社 PII の参照経路、ID の推測可能性、自己申告に依存する統制を実測 |
| A05 設定 | 権限（TRUNCATE/TRIGGER/REFERENCES）、FORCE RLS、関数の EXECUTE、全表の RLS 突合 |
| A09 ログ | 監査表・トリガの有無、*_by 列の検証 |
| 個人情報保護法 | 共同利用（第27条第5項第3号）の公表事項・同意の記録、保存期間・消去（第22条、第33〜35条） |
| TS 純粋関数 | tsc で JS 化して Node 22 で実行。型混同、null 入力、プロトタイプ汚染、ReDoS、巨大入力 |
| 依存関係 | `pnpm audit --json` を packages/input-core の path に絞って抽出 |
| Secrets | `git diff origin/main...HEAD` の追加行を 14 パターン（AWS・GCP・Supabase service_role・JWT・OpenAI/Anthropic・Stripe・GitHub PAT・Slack・PEM・接続文字列・SMTP・パスワード・OAuth など）で走査 |

使い捨て DB `sec_atk` は検証後に削除した（`select datname from pg_database` で消滅を確認）。リポジトリで編集したのは本レポートと `spec/reviews/sprint-8/security-findings/` のみ。

### RLS 突合表（全テーブル。0410 以降の追加分 + 既存の関連表）

| テーブル | RLS | FORCE | ポリシー | 判定 |
|---|---|---|---|---|
| groups | 有 | 無 | platform(ALL) / company(select, 自社の group) | 越境なし。FORCE 無しは SEC-017 |
| persons | 有 | 無 | platform(ALL) / company_read(自社に雇用がある人。0418) | 越境なし。書込ポリシー無し=会社は書けない。ロール未区別は SEC-003 |
| job_roles | 有 | 無 | platform(ALL) / company(select, 自グループ) | 越境なし |
| jobs | 有 | 無 | platform(ALL) / company(ALL, company_id 一致) | 越境なし（WITH CHECK 有）。書込の自己申告は SEC-005 |
| job_shifts | 有 | 無 | 同上 + 親一致トリガ | 越境なし |
| job_applications | 有 | 無 | 同上 + 親一致トリガ | 越境なし。直接書込は SEC-002 |
| staff | 有 | 有 | staff_sel のみ（現場スコープ。会社の書込ポリシー無し） | 直接の書込は拒否（B10, B11 で確認） |
| companies | 有 | 無 | platform(ALL) / company(select) | group_id の付け替えは拒否（B05） |
| app_profiles | 有（0300） | 無 | self_read のみ | 昇格は拒否（B12, B13）。※試験連鎖に 0300 が無いと RLS が付かない（情報 INFO-1） |

## 2. Finding 一覧

| ID | Severity | CVSS | 概要 | OWASP | ファイル:行 |
|---|---|---|---|---|---|
| SEC-001 | High | 8.2 | TRUNCATE ... CASCADE で全テナントの人・雇用・案件を一括消去できる（KR-4 の実測。影響は想定より広い） | A05:2021 | `supabase/migrations/0410_talent_foundation.sql:13-118,138-157` |
| SEC-002 | High | 7.1 | 会社管理者が job_applications を直接書き換え・削除でき、同意・決定者・労働条件通知の記録を偽装できる（KR-1 の実測） | A01:2021 | `supabase/migrations/0410_talent_foundation.sql:104-119,153-157` |
| SEC-003 | Medium | 6.5 | 会社に属する全ロールが、自社の全員の生年月日・電話・メール・在留情報を読め、候補検索も呼べる（KR-5 / OQ-22 / OQ-19 / OQ-20） | A01:2021 | `supabase/migrations/0418_talent_persons_rls_perf.sql:289-300` |
| SEC-004 | Medium | 6.5 | checkEligibility が入力件数に対し 2 乗時間で、数千件のシフトでサーバを数十秒止められる | A04:2021 | `packages/input-core/src/talent/eligibility.ts:181-203` |
| SEC-005 | Medium | 6.5 | 警備・線引き・派遣の統制が、案件を作る会社自身の自己申告（職種の選択・needs_boundary_check・確認者の文字列）で回避できる（KR-3 / OQ-21） | A04:2021 | `supabase/migrations/0417_talent_boundary_status_space.sql:244-278` |
| SEC-006 | Medium | 5.4 | 監査証跡が無い: 同意の変更・PII の参照・候補検索が記録されず、created_by / decided_by / boundary_confirmed_by は自己申告の文字列 | A09:2021 | `supabase/migrations/0410_talent_foundation.sql:21-36,68-88,104-118` |
| SEC-007 | Medium | 5.3 | checkEligibility / listRenewals が実行時に型を検証せず、"false"（文字列）の同意・在留可否が真として扱われ、null で TypeError になる | A03:2021 | `packages/input-core/src/talent/eligibility.ts:145-156,193` |
| SEC-008 | Medium | 5.3 | staff.person_id が雇用先の会社のグループと一致するかを DB が検査せず、候補検索の id で他人の PII 全項目を読める経路になる | A01:2021 | `supabase/migrations/0413_talent_hardening2.sql:10-23` |
| SEC-009 | Medium | 4.9 | 共同利用の同意の記録が仕様に足りず、改ざん・前倒し・代理記録が DB で止まらない（OQ-12a/b/c、個人情報保護法 第27条第5項第3号） | A04:2021 | `supabase/migrations/0410_talent_foundation.sql:29-31` |
| SEC-010 | Medium | 4.3 | search_candidates が件数・頻度の制限なしにグループ全員の氏名と person_id を一括取得させる | A04:2021 | `supabase/migrations/0412_talent_hardening.sql:208-228` |
| SEC-011 | Medium | 4.4 | PII（氏名・生年月日・電話・メール・在留情報）が平文の列で、persons と staff に重複して持たれる | A02:2021 | `supabase/migrations/0410_talent_foundation.sql:21-36` |
| SEC-012 | Medium | 4.7 | input-core の devDependencies の推移的依存に High の既知脆弱性（brace-expansion）が残る（Gate 3 の「High 0 件」に抵触） | A06:2021 | `pnpm-lock.yaml:(@vitest/coverage-v8 → test-exclude → minimatch → brace-expansion)` |
| SEC-013 | Low | 3.3 | マイグレーションの再適用で強化済みの関数・ポリシーが旧版に戻り、グループ越境の職種が通る（KR-2 の実測） | A05:2021 | `supabase/migrations/0410_talent_foundation.sql:122-136,159-162` |
| SEC-014 | Medium | 4.3 | DB・TS ともに文字列長・件数の上限が無い（3,000,000 文字のタイトル、50MB の確認者、長い personId の整列） | A04:2021 | `packages/input-core/src/talent/renewal.ts:38-50,95-101` |
| SEC-015 | Low | 3.1 | 退職者の個人情報が会社から永久に読め、削除・匿名化の手段が無い | A04:2021 | `supabase/migrations/0418_talent_persons_rls_perf.sql:289-300` |
| SEC-016 | Low | 3.1 | 例外メッセージが入力値を反映し、内部の型エラー文言がそのまま上位に出る | A09:2021 | `packages/input-core/src/talent/renewal.ts:55` |
| SEC-017 | Low | 3.1 | 最小権限の不足: SECURITY DEFINER のトリガ関数に既定の EXECUTE、新テーブルに GRANT ALL と FORCE RLS なし | A05:2021 | `supabase/migrations/0414_talent_integrity.sql:89-115` |

## 3. 実行して防げた攻撃（PASS の根拠）

使い捨て DB で実行した結果。「ERR / OK rows=0」は攻撃が失敗した（防げた）ことを示す。

| # | 攻撃 | 実行主体 | 結果 |
|---|---|---|---|
| B01 | 他グループの persons を読む | B1社管理者 | 0 件（PASS） |
| B02 | 他グループの会社で search_candidates | B1社管理者 | ERR 権限がありません（PASS） |
| B03 | 同上（別グループ内の他社 id） | B1社管理者 | ERR（PASS） |
| B04 | search_candidates(NULL) | B1社管理者 | ERR（PASS） |
| B05 | 自社の companies.group_id を他グループへ付け替え | B1社管理者 | rows=0、値は不変（PASS） |
| B06 | persons へ INSERT | B1社管理者 | ERR RLS 違反（PASS） |
| B07 | 自分の person の同意フラグを UPDATE | B1社管理者 | rows=0（PASS） |
| B08 | persons を DELETE | B1社管理者 | rows=0（PASS） |
| B10 | A群の person を指す staff を INSERT | B1社管理者 | ERR RLS 違反（PASS） |
| B11 | staff.person_id を A群の person に UPDATE | B1社管理者 | rows=0（PASS） |
| B12 | app_profiles に platform_admin を INSERT | B1社管理者 | ERR RLS 違反（PASS。垂直昇格不可） |
| B13 | 自分の app_profiles.role を platform_admin に UPDATE | B1社管理者 | rows=0（PASS） |
| B14, B15 | 他社の jobs / job_shifts / job_applications を読む | B1社管理者 | 他社 0 件、自社のみ（PASS。水平越境なし） |
| B16 | 他社 A1 の job を INSERT | B1社管理者 | ERR RLS の WITH CHECK 違反（PASS） |
| B17 | 他グループの職種で job を作成 | B1社管理者 | ERR 職種が自社のグループに属していません（PASS） |
| B18/B20/B22 | 存在しない id と他社の id でエラー文言が違うか（存在確認の oracle） | B1社管理者 | 文言が同一（PASS。IDOR で他社の id の存在を探れない） |
| B19 | 他社 A1 の job にシフトを追加 | B1社管理者 | ERR シフトの会社が案件の会社と一致しません（PASS） |
| B21 | 他社 A1 のスタッフで自社シフトに応募 | B1社管理者 | ERR 応募の会社が…一致しません（PASS） |
| B23 | app_company_has_person で他社の person の所属を探る | B1社管理者 | false（PASS。自社に限る） |
| B24 | トリガ関数を直接呼ぶ | B1社管理者 | ERR trigger functions can only be called as triggers（PASS） |
| N01 | persons を読む | anon | ERR permission denied for function（PASS） |
| N02 | search_candidates | anon | ERR permission denied（PASS。0412 の revoke が効いている） |
| N03 | persons へ INSERT | anon | ERR RLS 違反（PASS） |
| N04/N05 | app_company_person_ids / app_company_has_person | anon | ERR permission denied（PASS） |
| N07 | jobs へ INSERT | anon | ERR RLS 違反（PASS） |
| U01, U02 | 会社なし（role=NULL）の認証ユーザーが persons / jobs / search_candidates | 会社なし | 0 件、ERR（PASS。NULL 会社での全件ヒットなし） |
| U03, U04 | プロフィールなしの認証ユーザー | 任意の uid | ERR、0 件（PASS） |
| C07 | 警備職種 × 派遣の案件 | A1社管理者 | ERR 警備業務は派遣にできません（PASS。法令の禁止は職種を通すと効く） |
| C03/C04 | 応募のある案件・シフトの削除 | A1社管理者 | ERR（PASS。ただし応募を先に消せば通る=SEC-002） |
| T-A03 | SECURITY DEFINER 関数の search_path | — | 全て `set search_path = public, pg_temp`（pg_catalog が先頭）。authenticated に public への CREATE 権限が無いことを確認（`has_schema_privilege = false`）。search_path 乗っ取りは不成立（Supabase 側でも public の CREATE を与えない前提） |
| T-A03b | 動的 SQL・`p_filter` の注入 | — | 動的 SQL は固定識別子の `format('%I')` のみ。`p_filter` は未使用。`search_candidates` は静的 SQL（PASS） |
| T-A04 | ID の推測 | — | 主キーは `gen_random_uuid()`（v4）で連番なし（PASS） |
| TS-1 | プロトタイプ汚染 | — | `JSON.parse('{"__proto__":{"consentJointUse":true}}')` を渡しても `no_consent` のまま。personId='__proto__' でも `Object.prototype` は汚染されず（`({}).polluted` 未定義）。コードに `Object.assign`・スプレッド代入・動的キーの書込みなし（PASS） |
| TS-2 | ReDoS | — | 正規表現 6 個（日付・時刻・不可視文字）は固定長または 1 回の文字クラス繰返しで、10MB 入力でも 5 ms（PASS） |
| TS-3 | 日付の形式バイパス | — | 全角数字、末尾改行（`'2026-12-01\n'`、`'09:00\n'`）は拒否（PASS）。年 0000 も暦として処理 |
| TS-4 | 例外による漏えい | — | 例外は型エラー文言と基準日の反射のみ。秘密情報・パス・SQL は出ない（Low=SEC-016） |
| S-1 | Secrets 走査 | — | 追加行に 14 パターンのヒット 0 件。`.env`・鍵ファイルの追加なし。ヒットしたのはドキュメント中の `PGPASSWORD=x`（使い捨て DB 用ダミー）のみ（PASS） |
| D-1 | 依存関係の変更 | — | Sprint 8 は package.json / pnpm-lock.yaml を変更していない（差分 0）。新規の実行時依存なし（純粋関数のみ） |
| R-1 | 修正の有効性 | — | revoke truncate・revoke DML を適用すると SEC-001/002 の攻撃が ERR になる（SEC-001, SEC-002 の再現手順に記載） |

## 4. Finding 詳細

### SEC-001　TRUNCATE ... CASCADE で全テナントの人・雇用・案件を一括消去できる（KR-4 の実測。影響は想定より広い）

- **Severity:** High　**CVSS v3.1:** 8.2　`CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:C/C:N/I:H/A:H`
- **OWASP:** A05:2021 Security Misconfiguration
- **場所:** `supabase/migrations/0410_talent_foundation.sql` 行 13-118,138-157
- **関連:** KR-4　**公開前の必須:** はい

**内容:** 新テーブルに TRUNCATE/TRIGGER/REFERENCES の取り消しが無く、Supabase 既定（anon/authenticated に ALL）のままだと、TRUNCATE は RLS と削除ガード（0414 のトリガ）を素通りする。persons を CASCADE で消すと staff・shifts・jyoban_*・job_applications まで全会社分が消えた。

**再現手順と結果:**

```
-- 環境: Supabase 既定相当（alter default privileges ... grant all on tables to anon, authenticated）
set role authenticated; set request.jwt.claim.sub='<A1社 company_admin>';
truncate job_applications;            -- => OK（RLS・0414 の削除ガードは TRUNCATE を見ない）
truncate persons cascade;             -- => OK。NOTICE: truncate cascades to table "staff","shifts","staff_sites","jyoban_reports","jyoban_devices","jyoban_slot_staff","jyoban_push_subscriptions","jyoban_notifications","job_applications"
select count(*) from persons;         -- => 0（staff も 0。他社 B1 の行も消えた）
-- 修正の検証
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
truncate job_applications;            -- => ERR: permission denied for table job_applications
truncate persons cascade;             -- => ERR: permission denied for table persons
```

**修正案:** マイグレーションに `revoke truncate, references, trigger on public.<新テーブル> from anon, authenticated;` を明記し、`alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;` を運用手順に入れる。PostgREST 経由では実行できないため直接接続の経路（接続情報の配布先）も棚卸しする。新テーブルには `force row level security` も付ける。

### SEC-002　会社管理者が job_applications を直接書き換え・削除でき、同意・決定者・労働条件通知の記録を偽装できる（KR-1 の実測）

- **Severity:** High　**CVSS v3.1:** 7.1　`CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:L`
- **OWASP:** A01:2021 Broken Access Control / A04:2021 Insecure Design
- **場所:** `supabase/migrations/0410_talent_foundation.sql` 行 104-119,153-157
- **関連:** KR-1、REQ-039　**公開前の必須:** はい

**内容:** `job_applications_company` は FOR ALL で company_id 一致のみを見る。同意なし（no_consent）のスタッフの応募を confirmed に変え、decided_by・decided_at・conditions_*_at を任意の値にでき、確定済みの応募を DELETE した後で案件も削除できた（0414 の削除ガードは応募が存在する間だけ有効）。応募の成立は労働契約の成立を伴うため、記録の改ざんと消去は労務紛争の証拠を失わせる。

**再現手順と結果:**

```
set role authenticated; set request.jwt.claim.sub='<A1社 company_admin>';
-- 同意なし(consent_joint_use=false)の人の応募を、決定者を偽装して確定
update job_applications set status='confirmed', decided_by='社長', decided_at='2020-01-01', conditions_notified_at=now(), conditions_confirmed_at=now() where id='aa11...';  -- => OK rows=1
delete from job_applications where id='aa11...';                 -- => OK rows=1（確定済みの記録を削除）
delete from job_shifts where job_id='e100...';                   -- => OK rows=1（応募が無くなったのでガードを通過）
delete from jobs where id='e100...';                             -- => OK rows=1
-- 修正の検証
revoke insert, update, delete on job_applications from authenticated;
insert into job_applications(...) values (... 'confirmed');      -- => ERR: permission denied for table job_applications
```

**修正案:** Sprint 9 の REQ-039 の通り、応募の作成・確定・取消は SECURITY DEFINER の RPC に限り、`job_applications` の insert/update/delete 権限を authenticated から取り消す（RLS の _company ポリシーは select のみに変更）。decided_by は auth.uid() から RPC 内で設定し、クライアント値を受けない。確定済みの応募は物理削除せず状態遷移＋履歴で残す。

### SEC-003　会社に属する全ロールが、自社の全員の生年月日・電話・メール・在留情報を読め、候補検索も呼べる（KR-5 / OQ-22 / OQ-19 / OQ-20）

- **Severity:** Medium　**CVSS v3.1:** 6.5　`CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N`
- **OWASP:** A01:2021 Broken Access Control
- **場所:** `supabase/migrations/0418_talent_persons_rls_perf.sql` 行 289-300
- **関連:** KR-5、OQ-22、OQ-19、OQ-20、REQ-040　**公開前の必須:** はい

**内容:** app_company_id() はロールを見ない。app_profiles.role が company_manager（0300 の CHECK で許可）の利用者は、自社の全 persons 行の birth_date・phone・email・residence_* を読め、search_candidates も呼べる。他社・他グループは越境できない（PASS）が、REQ-040 の許可表（現場責任者は自現場のみ、管制は拒否）と DB の実態が一致しない。

**再現手順と結果:**

```
set role authenticated; set request.jwt.claim.sub='<A1社の app_profiles に載る company_admin 以外のロール。試験環境では role=staff、本番は 0300 の CHECK で company_manager>';
select count(*), string_agg(birth_date||' '||phone||' '||email, ' | ') from persons;   -- => 2 件 '1990-01-01 09011112222 a1@example.com | 1985-05-05 09033334444 a2@example.com'
select count(*) from search_candidates('<A1社>');                                        -- => 3
```

**修正案:** REQ-040 の許可表に合わせ、persons の参照を「ロール × 範囲（現場・支店・自社）」で絞る。birth_date・phone・email は列単位で分け（別テーブルまたはビュー＋列権限）、一覧用の最小列（id, name）と PII 列を分離する。OQ-22 が決まるまで画面・API に persons を出さない。

### SEC-004　checkEligibility が入力件数に対し 2 乗時間で、数千件のシフトでサーバを数十秒止められる

- **Severity:** Medium　**CVSS v3.1:** 6.5　`CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:H`
- **OWASP:** A04:2021 Insecure Design（資源消費）
- **場所:** `packages/input-core/src/talent/eligibility.ts` 行 181-203
- **関連:** REQ-026　**公開前の必須:** はい

**内容:** シフト s ごとに `busy.some(...)`（行 202）と、18 歳未満では `job.shifts.some(shiftIsNight)`（行 186）を回すため O(S×B + S²)。DB に案件あたりのシフト数の上限が無く（job_shifts に件数制約なし）、会社管理者が大量のシフトを作れば、全スタッフの一覧表示（listApplicableJobs）が同じ Node プロセスを占有する。

**再現手順と結果:**

```
node ts_atk3.mjs（tsc で JS 化した checkEligibility を直接実行。成人、他日付の busy で重なりなし）
shifts=1000, busy=1000 -> 1734 ms
shifts=2000, busy=2000 -> 5876 ms
shifts=4000, busy=4000 -> 24476 ms        （2 倍で約 4 倍）
18 歳未満・日中シフト: shifts=5000 -> 9498 ms, shifts=10000 -> 35622 ms
```

**修正案:** (1) shiftIsNight の結果を 1 回だけ計算してループ外に出す。(2) busy を日付ごとの配列（Map）に前処理し、同日分とだけ重なりを比べる。(3) 入力件数の上限（例: shifts ≤ 200、busy ≤ 500）を超えたら invalid_input。(4) DB 側でも案件あたりのシフト数に上限を置く（トリガ）。

### SEC-005　警備・線引き・派遣の統制が、案件を作る会社自身の自己申告（職種の選択・needs_boundary_check・確認者の文字列）で回避できる（KR-3 / OQ-21）

- **Severity:** Medium　**CVSS v3.1:** 6.5　`CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N`
- **OWASP:** A04:2021 Insecure Design
- **場所:** `supabase/migrations/0417_talent_boundary_status_space.sql` 行 244-278
- **関連:** KR-3、OQ-21、REQ-034、REQ-027　**公開前の必須:** はい

**内容:** 契約の形が security でも職種が非警備（または role_id が NULL）なら公開でき、TS 側も `isSecurityWork` だけを見て form を見ないため、警備の年齢・教育の判定を受けない。needs_boundary_check は案件作成者が false にでき、boundary_confirmed_by は任意の文字列（「だれか」）で通る。警備業法・派遣法の統制が会社の自己申告に依存する。

**再現手順と結果:**

```
-- DB（authenticated, A1社管理者）
insert into jobs(company_id,title,form,role_id,status) values ('<A1>','警備だが職種なし','security',null,'published');             -- => OK
insert into jobs(...,form,role_id,status) values (...,'security','<軽作業(is_security=false)>','published');                    -- => OK
insert into jobs(...,form,role_id,employment_days,status) values (...,'dispatch','<軽作業>',10,'published');                    -- => OK（実は警備の派遣でも通る）
insert into jobs(...,needs_boundary_check,status) values (...,false,'published');                                                -- => OK
insert into jobs(...,needs_boundary_check,status,boundary_confirmed_by,boundary_confirmed_on) values (...,true,'published','だれか',current_date); -- => OK
-- TS
checkEligibility(person(教育なし), job({form:'security', isSecurityWork:false})) -> {"eligible":true,"reasons":[]}
```

**修正案:** form=security の案件は is_security=true の職種を必須にする CHECK/トリガ（逆に is_security=true の職種で form=security 以外は拒否）。TS は `isSecurityWork || form==="security"` で判定。needs_boundary_check は職種マスタの既定値を DB で強制し、変更は本社ロールの RPC に限る（REQ-034b/037）。確認者は app_profiles の user_id と確認時刻をサーバ側で記録し、自由記述にしない。

### SEC-006　監査証跡が無い: 同意の変更・PII の参照・候補検索が記録されず、created_by / decided_by / boundary_confirmed_by は自己申告の文字列

- **Severity:** Medium　**CVSS v3.1:** 5.4　`CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:L/A:N`
- **OWASP:** A09:2021 Security Logging and Monitoring Failures
- **場所:** `supabase/migrations/0410_talent_foundation.sql` 行 21-36,68-88,104-118
- **関連:** REQ-035、REQ-039　**公開前の必須:** はい

**内容:** 0410〜0418 に監査テーブル・監査トリガが無く（`pg_tables` で audit|history|log に一致する表が 0 件、persons のトリガも 0 件）、「誰がいつ同意を変えたか」「誰がどの人の PII を見たか」「誰が候補検索で何件取得したか」を後から示せない。jobs.created_by / job_applications.decided_by / boundary_confirmed_by は text で、auth.uid() と結び付かず偽装できる（SEC-002 の実測）。

**再現手順と結果:**

```
select string_agg(tablename,',') from pg_tables where schemaname='public' and tablename ~* 'audit|history|log';   -- => none
select string_agg(tgname,',') from pg_trigger where tgrelid='persons'::regclass and not tgisinternal;               -- => none
insert into jobs(company_id,title,form,status,created_by) values ('<A1>','x','security','published','偽装 太郎');  -- => OK（created_by は検証されない）
```

**修正案:** persons / job_applications / jobs に対する変更履歴テーブルとトリガ（旧値・新値・auth.uid()・時刻）。同意の変更は append-only の consent_events に分離。search_candidates と PII 参照の RPC は呼出者・会社・件数を access_log に記録する。*_by 列は uuid（auth.uid()）に置き換え、サーバ側で設定する。

### SEC-007　checkEligibility / listRenewals が実行時に型を検証せず、"false"（文字列）の同意・在留可否が真として扱われ、null で TypeError になる

- **Severity:** Medium　**CVSS v3.1:** 5.3　`CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:H/A:N`
- **OWASP:** A03:2021 Injection（型混同）/ A04:2021
- **場所:** `packages/input-core/src/talent/eligibility.ts` 行 145-156,193
- **関連:** REQ-026、REQ-035　**公開前の必須:** はい

**内容:** 日付は isRealDate で検証しているが、consentJointUse と residence.workAllowed は真偽値の型を確認せず `!person.consentJointUse` / `!res.workAllowed` で評価する。API が JSON や DB のテキスト列から値を渡すと、"false" が eligible=true を生む。guardTraining や employments が null/undefined の入力は不明な TypeError で落ち、検証済みの invalid_input にならない。

**再現手順と結果:**

```
checkEligibility(person({consentJointUse:'false'}), job())          -> {"eligible":true,"reasons":[]}      ← 同意なしが通る
checkEligibility(person({residence:{workAllowed:'false'}}), job())  -> {"eligible":true,"reasons":[]}
checkEligibility(person({consentJointUse:0}), job()).reasons         -> ["no_consent"]
checkEligibility(person({guardTraining:null}), job())                -> THROWS TypeError: Cannot read properties of null (reading 'annualFiscalYears')
checkEligibility(person({employments:undefined}), job())             -> THROWS TypeError: Cannot read properties of undefined (reading 'some')
checkEligibility(person(), job({shifts:null}))                       -> THROWS TypeError
listRenewals([null], '2026-11-08')                                   -> THROWS TypeError
```

**修正案:** 境界（API/RPC の入口）で Zod により PersonProfile / JobPost / BusyShift をパースし、純粋関数側でも `typeof x === "boolean"` と配列・オブジェクトの存在を確認して invalid_input を返す。判定は fail-closed（真偽値でなければ拒否）。

### SEC-008　staff.person_id が雇用先の会社のグループと一致するかを DB が検査せず、候補検索の id で他人の PII 全項目を読める経路になる

- **Severity:** Medium　**CVSS v3.1:** 5.3　`CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:H/I:N/A:N`
- **OWASP:** A01:2021 Broken Access Control / A04:2021 Insecure Design
- **場所:** `supabase/migrations/0413_talent_hardening2.sql` 行 10-23
- **関連:** REQ-035、REQ-035b　**公開前の必須:** はい

**内容:** persons を読める条件は「自社に staff.person_id で結ばれていること」だけ。staff.person_id にグループ一致の制約・トリガが無く、別グループの person や、同グループの同意なし・未雇用の person を結べば、その人の birth_date・phone・email・在留期限まで読める。今は staff に company の書込ポリシーが無いため会社は直接結べないが、Sprint 9 の登録 RPC が呼出元の渡す person_id を受けると、search_candidates が返す id（名前だけに絞った設計）が PII 全項目への鍵になる。

**再現手順と結果:**

```
-- 特権側（Sprint 9 の RPC を想定して postgres で挿入）: B1社(別グループ)の staff に A グループの person(同意なし)を結ぶ
insert into staff(id,company_id,person_id,name,staff_no) values (..., '<B1>', '<A群 同意なし person>', 'link','LINK');
set role authenticated; set request.jwt.claim.sub='<B1社 company_admin>';
select name, birth_date, phone, email, residence_expires_on from persons where group_id='<A群>';
-- => A1雇用・同意なし 1985-05-05 09033334444 a2@example.com res=2027-01-01
-- 不整合の検出: select count(*) from staff s join persons p on p.id=s.person_id join companies c on c.id=s.company_id where c.group_id is distinct from p.group_id;  -- => 1
```

**修正案:** staff の person_id 設定時に `persons.group_id = companies.group_id` を検査するトリガ（SECURITY DEFINER）。候補から雇用へ進む RPC は、同意済みであること・同グループであることを内部で再検証し、PII 列は雇用成立後にだけ可視にする。

### SEC-009　共同利用の同意の記録が仕様に足りず、改ざん・前倒し・代理記録が DB で止まらない（OQ-12a/b/c、個人情報保護法 第27条第5項第3号）

- **Severity:** Medium　**CVSS v3.1:** 4.9　`CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:H/A:N`
- **OWASP:** A04:2021 Insecure Design / A09:2021
- **場所:** `supabase/migrations/0410_talent_foundation.sql` 行 29-31
- **関連:** OQ-12a、OQ-12b、OQ-12c、REQ-035、REQ-035b　**公開前の必須:** はい

**内容:** REQ-035 は「同意・取得日時・取得主体・通知文の版」を本人の送信で保存し、管理者の代理記録はしないとするが、persons には consent_joint_use と consent_at しか無い。運営ロールは consent を true にでき、consent_at に未来日（2099）も入る。撤回後も consent_at が残り撤回時刻が無い。共同利用に必要な公表事項（項目・利用者の範囲・利用目的・責任者の氏名または名称）の保存先が無く、OQ-12a（項目一覧）と OQ-12c（通知文と版）が未決のため、同意が何に対するものか証明できない。

**再現手順と結果:**

```
set role authenticated; set request.jwt.claim.sub='<platform_admin>';
update persons set consent_joint_use=true, consent_at='2099-01-01' where id='<同意なしの人>';   -- => OK（本人送信を伴わず、未来日も許可）
update persons set consent_joint_use=false where id='<同じ人>';                                  -- => OK。consent_at は 2099-01-01 のまま残る（撤回時刻・理由・版なし）
```

**修正案:** consent_events（person_id, action=grant|withdraw, notice_version, items_snapshot, collector, collected_at, channel=app|paper, recorded_by）を append-only で新設し、persons.consent_* は RPC のみが更新する。consent_at <= now() の CHECK。通知文の版テーブルに、共同利用する項目・利用者の範囲・目的・責任者を持たせる。OQ-12a/b/c は弁護士の確認後に確定し、本人が通知を読んだ版でなければ同意を有効にしない。公開前に責任者の公表場所を決める。

### SEC-010　search_candidates が件数・頻度の制限なしにグループ全員の氏名と person_id を一括取得させる

- **Severity:** Medium　**CVSS v3.1:** 4.3　`CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N`
- **OWASP:** A04:2021 Insecure Design
- **場所:** `supabase/migrations/0412_talent_hardening.sql` 行 208-228
- **関連:** REQ-035　**公開前の必須:** いいえ

**内容:** ページング・limit・p_filter の実装・呼出回数制限・ログが無い。会社のどのロールでも 1 回の呼出でグループの同意済み全員を取得でき（10 万件を 127 ms）、他子会社の人材を引き抜き目的で列挙する用途や、スクレイピングを防げない。

**再現手順と結果:**

```
-- persons に同意済み 100,002 件を投入
set role authenticated; set request.jwt.claim.sub='<A1社 company_admin>';
select count(*) from search_candidates('<A1>');   -- => 100002 （Time: 126.958 ms）
```

**修正案:** limit/offset（上限 50）とカーソル、呼出元・件数の access_log、ユーザーごとのレート制限。ロールを絞る（SEC-003）。氏名の返却は部分一致の検索語を必須にし、無条件一覧を禁止する。

### SEC-011　PII（氏名・生年月日・電話・メール・在留情報）が平文の列で、persons と staff に重複して持たれる

- **Severity:** Medium　**CVSS v3.1:** 4.4　`CVSS:3.1/AV:N/AC:H/PR:H/UI:N/S:U/C:H/I:N/A:N`
- **OWASP:** A02:2021 Cryptographic Failures
- **場所:** `supabase/migrations/0410_talent_foundation.sql` 行 21-36
- **関連:** NFR　**公開前の必須:** いいえ

**内容:** Supabase はディスクと通信を暗号化するが、列は平文のため、論理ダンプ・バックアップ・service_role の誤用・SQL ログへの引数出力・pg_stat_statements で全項目が読める。persons と staff（dob, phone, pin_current）に同じ種類の情報が別の RLS で重複し、片方だけ修正されるずれが起きる。persons の email・phone・birth_date に形式の CHECK も無い（staff には staff_phone_fmt がある）。

**再現手順と結果:**

```
select column_name, data_type from information_schema.columns where table_name='persons';   -- => name,name_kana,birth_date,phone,email... すべて text/date の平文
insert into persons(group_id,name,email,phone,birth_date) values ('<A>','x','not-an-email','<script>','2999-01-01');   -- => OK（platform_admin）
```

**修正案:** birth_date・phone・email を pgcrypto/pgsodium（Supabase Vault の鍵）で列暗号化するか、少なくとも別テーブル（persons_pii）に分け、列権限で一覧用と分離する。persons を正とし、staff の重複列は移行後に削除する。形式の CHECK と birth_date <= current_date を追加。DB ログに RPC 引数を出さない設定を確認する。

### SEC-012　input-core の devDependencies の推移的依存に High の既知脆弱性（brace-expansion）が残る（Gate 3 の「High 0 件」に抵触）

- **Severity:** Medium　**CVSS v3.1:** 4.7　`CVSS:3.1/AV:L/AC:H/PR:N/UI:R/S:U/C:N/I:N/A:H`
- **OWASP:** A06:2021 Vulnerable and Outdated Components
- **場所:** `pnpm-lock.yaml` 行 (@vitest/coverage-v8 → test-exclude → minimatch → brace-expansion)
- **関連:** —　**公開前の必須:** いいえ

**内容:** `pnpm audit` はリポジトリ全体で 32 件（critical 4 / high 9 / moderate 18 / low 1）。packages/input-core に届くのは @vitest/coverage-v8>test-exclude 経由の brace-expansion（GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p: high。GHSA-q2hr-2g5m-vwhr, glob, minimatch: moderate）のみで、すべて開発時のみ・攻撃者が glob パターンを渡す経路が無いため CVSS は環境値で 4.7 とした。ただし TRAID の Gate は推移的依存の High を 0 件と定めるため、判定は Evaluator に委ねる。Sprint 8 は package.json / pnpm-lock.yaml を変更しておらず（差分 0）、既存の負債。critical 4 件は apps/ 側で本監査の対象外。

**再現手順と結果:**

```
pnpm audit --json | node -e '...'   （packages__input-core で始まる path のみ抽出）
high brace-expansion >=2.0.0 <2.1.6 -> >=2.1.6 GHSA-qhr7-859c-m2p7 packages__input-core>@vitest/coverage-v8>test-exclude>glob>minimatch>brace-expansion
high brace-expansion >=4.0.0 <5.0.10 -> >=5.0.10 GHSA-6j4f-fj2g-mc7p packages__input-core>@vitest/coverage-v8>test-exclude>minimatch>brace-expansion
moderate glob >=9.0.0 <=14.0.1 -> >=14.0.2 GHSA-3g3m-2fjr-6pw4 ...
```

**修正案:** `pnpm.overrides` で brace-expansion を ≥2.1.7 / ≥5.0.12、glob ≥14.0.2、minimatch ≥11.0.1 に固定するか、@vitest/coverage-v8 を更新する。`--force` 系の握り潰しはしない。apps/ の critical 4 件は別 Finding として DevOps に回す。

### SEC-013　マイグレーションの再適用で強化済みの関数・ポリシーが旧版に戻り、グループ越境の職種が通る（KR-2 の実測）

- **Severity:** Low　**CVSS v3.1:** 3.3　`CVSS:3.1/AV:N/AC:H/PR:H/UI:N/S:U/C:L/I:L/A:N`
- **OWASP:** A05:2021 Security Misconfiguration
- **場所:** `supabase/migrations/0410_talent_foundation.sql` 行 122-136,159-162
- **関連:** KR-2　**公開前の必須:** いいえ

**内容:** 0410 は CREATE OR REPLACE FUNCTION で jobs_guard_security_dispatch を旧版（SECURITY DEFINER でなく、グループ・サイト検査なし）に戻し、persons_company_read も旧版に戻す。ランナーが番号順 1 回の前提を守らないと、他グループの職種を使う案件が通り、persons が会社に見えなくなる。

**再現手順と結果:**

```
psql -f 0410_talent_foundation.sql   （0418 適用後に再実行）
select prosecdef from pg_proc where proname='jobs_guard_security_dispatch';   -- => f
set role authenticated; (B1社管理者)
insert into jobs(company_id,title,form,role_id) values ('<B1>','x','spot','<A群の警備職種>');   -- => OK rows=1（再適用前は 職種が自社のグループに属していません）
select count(*) from persons;   -- => 0（自社の 1 件が見えなくなる）
```

**修正案:** 適用済みバージョンを記録するマイグレーションランナー（supabase migration の履歴表）を必須にし、番号の飛び越し・再実行を CI で拒否する。関数の最終形を 1 つの「現行版」ファイルに寄せる。

### SEC-014　DB・TS ともに文字列長・件数の上限が無い（3,000,000 文字のタイトル、50MB の確認者、長い personId の整列）

- **Severity:** Medium　**CVSS v3.1:** 4.3　`CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L`
- **OWASP:** A04:2021 Insecure Design（資源消費）
- **場所:** `packages/input-core/src/talent/renewal.ts` 行 38-50,95-101
- **関連:** —　**公開前の必須:** いいえ

**内容:** compareCodePoints は比較のたびに Array.from で両文字列を配列化するため、長い personId の整列が極端に遅い（200 人 × 20 万文字で 8.3 秒）。boundaryRecorded の正規表現は線形だが 50MB で 1.7 秒。DB は jobs.title に 300 万文字を受け付けた。ReDoS（破滅的バックトラック）は、全 6 つの正規表現が固定長または文字クラスの 1 回繰り返しで、10MB の入力でも 5 ms のため該当なし。

**再現手順と結果:**

```
listRenewals(200 人, personId=あ×200000+i) -> 8259 ms
checkEligibility(... confirmedBy=' '×50,000,000+'x') -> 1677 ms
listRenewals(200000 人) -> 853 ms（許容）
isRealDate('1'×10,000,000) -> 5 ms（ReDoS なし）
insert into jobs(company_id,title,form) values (..., repeat('あ',3000000), 'spot');  -- => OK
```

**修正案:** compareCodePoints を `for (let i=0;;)` で codePointAt を使う非割当の実装にするか、`a < b` が UTF-16 順になることを避けたいなら長さの上限（personId ≤ 64 文字）を入口で検証。DB は text 列に `check (length(title) <= 200)` など上限を置く。API 層でリクエスト本文の上限（例: 1MB）。

### SEC-015　退職者の個人情報が会社から永久に読め、削除・匿名化の手段が無い

- **Severity:** Low　**CVSS v3.1:** 3.1　`CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:L/I:N/A:N`
- **OWASP:** A04:2021 Insecure Design（個人情報保護法 第22条 データ内容の正確性・利用する必要が無くなった時の消去）
- **場所:** `supabase/migrations/0418_talent_persons_rls_perf.sql` 行 289-300
- **関連:** —　**公開前の必須:** いいえ

**内容:** persons_company_read は staff 行が存在すれば足り、is_active=false・left_on が過去でも可視。persons の削除は staff.person_id の外部キー（ON DELETE 指定なし）で阻まれ、匿名化の仕組みも無い。開示・利用停止・消去の請求（法第33〜35条）への対応手段が DB に無い。

**再現手順と結果:**

```
update staff set left_on='2020-01-01', is_active=false where id='<A1の元社員>';
select count(*) from persons where id='<その人>';   -- A1管理者 => 1（退職後も全項目が読める）
```

**修正案:** 保存期間（例: 退職から N 年）を決め、満了後は PII 列を NULL 化する匿名化 RPC と、本人請求の処理手順を用意する。退職者の可視範囲は人事担当ロールに限る。

### SEC-016　例外メッセージが入力値を反映し、内部の型エラー文言がそのまま上位に出る

- **Severity:** Low　**CVSS v3.1:** 3.1　`CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:L/I:N/A:N`
- **OWASP:** A09:2021 / A05:2021
- **場所:** `packages/input-core/src/talent/renewal.ts` 行 55
- **関連:** —　**公開前の必須:** いいえ

**内容:** listRenewals は不正な基準日を `RangeError(基準日が不正です: ${referenceDate})` と入力そのままで投げる。上位が例外メッセージを応答に載せると、任意文字列が反射される（HTML として出すと XSS の足場）。null 入力では "Cannot read properties of null (reading employments)" など実装の内部構造が出る（SEC-007）。

**再現手順と結果:**

```
listRenewals([], '<img src=x onerror=alert(1)>') -> THROWS RangeError: 基準日が不正です: <img src=x onerror=alert(1)>
```

**修正案:** メッセージに入力値を含めず固定文言＋エラーコードにする。API 層で例外をログに記録し、クライアントへは汎用エラーを返す。

### SEC-017　最小権限の不足: SECURITY DEFINER のトリガ関数に既定の EXECUTE、新テーブルに GRANT ALL と FORCE RLS なし

- **Severity:** Low　**CVSS v3.1:** 3.1　`CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:L/I:N/A:N`
- **OWASP:** A05:2021 Security Misconfiguration
- **場所:** `supabase/migrations/0414_talent_integrity.sql` 行 89-115
- **関連:** KR-4　**公開前の必須:** いいえ

**内容:** jobs_guard_* / job_*_guard_* の 5 関数は SECURITY DEFINER で、PUBLIC・anon・authenticated に EXECUTE が付く。trigger 関数は直接呼べないため（実測: "trigger functions can only be called as triggers"）今は悪用できないが、将来 SECURITY DEFINER の通常関数を同じ書き方で足すと anon に漏れる。persons ほか 6 表は FORCE RLS なし（所有者は RLS を素通り。Supabase の postgres/service_role は元から素通りのため影響は限定）。app_company_has_person は 0418 で不要になったが authenticated に残る。

**再現手順と結果:**

```
set role authenticated; select jobs_guard_security_dispatch();   -- => ERR: trigger functions can only be called as triggers
select proacl from pg_proc where proname='job_shifts_guard_company';   -- => =X/postgres,anon=X/postgres,authenticated=X/postgres
select relname, relforcerowsecurity from pg_class where relname in ('persons','jobs','job_shifts','job_applications','groups','job_roles');   -- => すべて f
```

**修正案:** トリガ関数に `revoke execute ... from public, anon, authenticated`。未使用の app_company_has_person を drop。新テーブルは `force row level security`。

## 5. 既知のリスク（KR）と Open Questions の評価

| 項目 | CVSS での評価 | 対応する Finding | 公開前の条件 |
|---|---|---|---|
| KR-1 応募テーブルの直接書き込み | High 7.1 | SEC-002 | RPC 化と権限取消が必須 |
| KR-2 マイグレーションの再適用 | Low 3.3 | SEC-013 | ランナーの履歴管理（運用）。実測で旧版に戻ることを確認 |
| KR-3 警備フラグと職種 | Medium 6.5 | SEC-005 | form=security の職種を DB で強制。OQ-21 と同時に |
| KR-4 TRUNCATE 権限 | High 8.2 | SEC-001 | 文書の想定（RLS・削除ガードの回避）より重い。CASCADE で他表も消える。権限取消が必須 |
| KR-5 候補検索と PII の範囲 | Medium 6.5 | SEC-003 | OQ-22 の決定と DB 反映 |
| OQ-12a/b/c 共同利用の項目・書面・通知文と版 | Medium 4.9（法令対応の未確定として必須扱い） | SEC-009 | 弁護士の確認、同意の記録の拡充、責任者の公表 |
| OQ-16 媒体の応募取り込み | 未実装のため評価対象外 | — | 取り込み実装前に再監査 |
| OQ-17 休業手当 / OQ-13 / OQ-14 | セキュリティ上の評価対象外（算定・運用の仕様） | — | — |
| OQ-18 有休・現任申込 | 既存実装の遡及仕様。本スプリントの対象外 | — | — |
| OQ-19 / OQ-20 支店・本社の範囲 | SEC-003 に含む | SEC-003 | OQ-22 と併せて REQ-040 を DB に反映 |
| OQ-21 線引き確認の要否 | SEC-005 に含む | SEC-005 | 本社のみ変更可を DB で強制 |
| OQ-22 候補検索の PII の範囲 | SEC-003 に含む | SEC-003 | 決定前は persons を画面に出さない |

## 6. 個人情報保護法との整合

| 要件 | 現状 | 判定 |
|---|---|---|
| 共同利用の公表事項（共同利用する旨、項目、利用者の範囲、利用目的、責任者の氏名または名称。第27条第5項第3号） | 項目一覧（OQ-12a）・通知文と版（OQ-12c）が未決。DB に通知の版・項目・責任者の保存先なし | 未充足（SEC-009） |
| 同意の記録（いつ・誰が・どの版に） | consent_joint_use と consent_at のみ。取得主体・版・撤回時刻・チャネルなし。運営が代理で true にでき、未来日も入る | 未充足（SEC-009） |
| 利用者の範囲の制限（必要最小限） | 同グループ内の同意済みのみが検索対象で、返す列は id と name（良い）。ただし会社内の全ロールが PII 全項目を読める | 一部未充足（SEC-003, SEC-008） |
| 安全管理措置（アクセス記録・監査） | PII の参照・変更の記録なし | 未充足（SEC-006） |
| 保存期間・消去・開示等の請求（第22条、第33〜35条） | 匿名化・削除手段なし | 未充足（SEC-015） |
| 要配慮個人情報 | persons には含まれない（在留資格の可否と期限のみ）。将来、健康・犯罪歴の列を足す場合は別途の同意が必要 | 該当なし |

## 7. 対象外の観察（Sprint 8 の差分ではないが、人材基盤の PII に影響するもの。件数には含めない）

- **INFO-1** 試験連鎖（`run_talent_rls_check.sh`）に 0300 が含まれず、`app_profiles` は RLS 無効のまま（`relrowsecurity=f`）になる。本番は 0300 で有効化されるため実害はないが、試験が本番と同じ連鎖ではない。0300 を加えるか、`app_profiles` の RLS を試験の前提条件として検査する。
- **INFO-2** 既存の `staff.pin_current` は PIN を平文で保存し、初期 PIN は生年月日の MMDD（`pin_from_dob`、0401）。`persons.birth_date` は SEC-003 により会社内の全ロールが読めるため、初期 PIN を変えていない勤務員の PIN が推測可能になる。`staff_login` は anon に開放されている。Sprint 8 の外だが、PII の範囲を決める（SEC-003）際に合わせて見直す。
- **INFO-3** Sprint 7 以前の `company_register_staff` などの SECURITY DEFINER 関数は PUBLIC/anon に EXECUTE が付く（会社が特定できないと内部で拒否される）。本監査の対象外。
- **INFO-4** `pnpm audit` はリポジトリ全体で critical 4 件を報告している。input-core には届かないため本監査の件数に含めない。DevOps に回付する。

## 8. Gate 3 への報告

- Critical: **0**　High: **2**（SEC-001, SEC-002）　Medium: 11　Low: 4
- RLS: 全テーブルで ENABLE ROW LEVEL SECURITY（FORCE は staff など既存の一部のみ。SEC-017）
- クロスユーザーアクセス: 越境 0 件をテストで証明（第3章）
- Secrets: 0 件　プロトタイプ汚染: 遮断（該当コード無し）　npm audit（input-core 到達分）: High 2 + moderate（SEC-012、開発時のみ）
- **Gate 3: 不合格（High 2 件）。** 修正は ⑥ Database Engineer（SEC-001, 002, 005, 006, 008, 009, 013, 017）と ⑧ Generator（SEC-004, 007, 014, 016）に差し戻す。修正後に再監査する。
