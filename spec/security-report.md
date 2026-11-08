# Sprint 8 セキュリティ監査レポート（人材基盤: talent）— 再監査

**監査者:** ⑪ Security Engineer 鍵山 剛　**再監査日:** 2026-11-08　**対象:** HEAD `3063bae`（初回監査は 9818be4 / 追補 v2.23）、spec/behavioral-spec.md 追補 v2.26（v2.25 の文面是正版）
**対象物:** `packages/input-core/src/talent/{model,eligibility,renewal}.ts`、`supabase/migrations/0410〜0420`、`supabase/tests/{run_talent_rls_check.sh,talent_rls_check.sql}`、`package.json` の pnpm.overrides / `pnpm-lock.yaml`。初回監査の記述は第1〜7章に残し、再監査の結果は冒頭と第3A章・各 Finding の「再監査」行に追記した。

## 第3回（差分再監査）の結論

**監査者:** ⑪ Security Engineer 鍵山 剛　**日付:** 2026-11-08　**対象:** HEAD `6278a3e`（0421、仕様 v2.28、supabase/tests の 90 シナリオ）

| Severity | 前回（open） | 第3回後（open） | 内訳 |
|---|---|---|---|
| Critical | 0 | **0** | — |
| High | 1 | **0** | SEC-001 を closed |
| Medium | 7 | **7** | SEC-003, 005, 006, 009, 010, 011, 014（変化なし） |
| Low | 8 | **9** | SEC-013, 015〜021 + 新規 SEC-022 |

**Gate 3（Critical 0 件 / High 0 件）: 合格。**

**SEC-001: closed。** 是正を信用せず、使い捨て Postgres 16 に本番と同じ連鎖（0000, 0100, 0102, 0103, 0200〜0202, 0400〜0402, 0406〜0421。前に `alter default privileges ... grant all on tables/functions/sequences to anon, authenticated`。0421 は 2 回適用して冪等を確認）を適用して攻撃した。
- 根拠1: public の 46 表で anon / authenticated / PUBLIC の TRUNCATE・REFERENCES・TRIGGER が 0 件（aclexplode で全リレーション、列権限、継承・パーティション、pg_default_acl まで確認）。
- 根拠2（対照）: 0421 だけ外した同じ連鎖では `truncate shifts` / `truncate notices` と staff への `create trigger` が成功した。攻撃が現実に通ることを確認したうえで、0421 適用後に全て拒否された。

実行した攻撃（anon / authenticated / app_client の 3 ロール × 46 表 × 15 種、約 2,070 回。成功した権限破壊は 0 件）:
1. 前回の攻撃の再実行: `truncate shifts / leave_requests / daily_reports / jyoban_reports / notices / app_profiles / staff / companies / sites / persons / job_applications / jobs / groups ... cascade`（26 件全て permission denied）。
2. TRIGGER 乗っ取り: staff への `create trigger`（pg_temp 関数、public 関数、constraint trigger）、`create rule`、`create policy`、`alter table ... disable trigger` はすべて拒否（permission denied / must be owner）。
3. TRUNCATE の変種: `truncate only`、`cascade`、`restart identity cascade`、パーティションの子、継承子、ビュー・マテリアライズドビュー（「is not a table」）。
4. 権限の付け直し: `grant truncate ... to authenticated`、`grant all ... to public`、`grant select ... with grant option` は非所有者のため「no privileges were granted」となり ACL は不変（実行後に ACL を再確認）。`grant authenticated to anon`、`alter role ... superuser`、`create extension`、`alter table ... owner to`、`disable/no force row level security` も拒否。
5. REFERENCES: 既存表への FK 追加、`references` 付きテーブルの作成、継承テーブルの作成は拒否（public スキーマへの CREATE 権限が anon/authenticated に無い）。
6. 後から作る物の既定の権限: テーブル・パーティション・継承子・ビュー・マテリアライズドビューは arwd のみ（TRUNCATE・TRIGGER・REFERENCES なし）。`alter default privileges` を authenticated が自分用に変えても他ロールに影響しない。シーケンスは rwU、関数は EXECUTE のまま（0421 の対象外。破壊的ではない）。
7. 他のスキーマ: auth / extensions への truncate は拒否。SECURITY DEFINER 関数に search_path 未固定のものは 0 件。public のテーブルの所有者は全て postgres（46 表）。
8. `SET ROLE` / `SET SESSION AUTHORIZATION postgres` は、検証セッションが superuser のため成功する。これは検証環境の都合で、本番のログインロールは非 superuser のため脆弱性ではない。

**過剰な取り消しの確認:** SELECT/INSERT/UPDATE/DELETE の付与数は 0421 の有無で同一（作ったテスト表を除き 362 件）。pg_policy 87 件、app_client の付与 32 件も同一。`supabase/tests/run_talent_rls_check.sh` の 90 シナリオと `run_jyoban_rls_check.sh` は全て PASS。

**前回 closed の回帰:** SEC-002（job_applications への直接書込は拒否のまま。90 シナリオの W 系が PASS）、SEC-004, 007, 008, 012 に変化なし（0421 は REVOKE のみで関数・テーブル定義・lockfile に触れない。差分は SQL 1 本と文書）。回帰なし。

**open の Medium/Low:** 変化なし。SEC-018〜021 は仕様 KR-7、SEC-006 は KR-6 に登録済みを確認（behavioral-spec.md 529〜530 行）。KR-4 は解消済みに更新され、OQ-23 に決定が記録されている。

**新規 Finding:** SEC-022（Low 3.1）。`alter default privileges` は実行ロール（postgres）の分だけで、別ロール（Supabase の supabase_admin など）が public にテーブルを作ると ALL が付く（再現済み）。0421 のコメントと KR-4 に運用手順としては書かれているが、検出手順が無い。通常のマイグレーションは postgres で動くため現状は発火しない。

**公開前の必須条件（第3回後）:** SEC-001 は満たされた。残りは SEC-003, 005, 006, 009 の 4 項目（Medium）と、前回の運用条件（REQ-039 の RPC まで job_applications への書込機能を作らない／OQ-12a/b/c の確定まで REQ-035b と共同利用を始めない／REQ-040 の許可表を DB に反映するまで persons を画面に出さない）。加えて、本番適用時に 0419〜0421 の適用と `select defaclrole::regrole, defaclacl from pg_default_acl` の確認を手順に入れる（SEC-022）。

## 再監査の結論

是正を信用せず、使い捨て Postgres 16 に本番と同じ連鎖（0000, 0100, 0102, 0103, 0200〜0202, 0400〜0402, 0406〜0420。Supabase の既定どおり、マイグレーションの前に `alter default privileges in schema public grant all on functions/tables/sequences to anon, authenticated` を設定）を適用し、初回と同じ攻撃を再実行したうえで、権限取消・トリガ・新関数を迂回する攻撃を約 130 件追加した（第3A章）。

| Severity | 初回 | 再監査後（open） | 内訳 |
|---|---|---|---|
| Critical（9.0〜10.0） | 0 | **0** | — |
| High（7.0〜8.9） | 2 | **1** | SEC-001（8.3。**継続・範囲を広げて再評価**） |
| Medium（4.0〜6.9） | 11 | **7** | SEC-003, 005, 006, 009, 010, 011, 014 |
| Low（0.1〜3.9） | 4 | **8** | SEC-013, 015, 016, 017 + 新規 SEC-018, 019, 020, 021 |

**Gate 3（Critical 0 件 / High 0 件）: 不合格（High 1 件 = SEC-001）。**

**判定:** 初回の High のうち SEC-002 は閉じた。SEC-001 は、**修正が対象とした 6 つの新テーブルについては閉じたが、同じ原因（Supabase 既定の TRUNCATE・TRIGGER・REFERENCES 権限）が既存の 40 テーブルに残っており、実測で全会社の勤務・日報・休暇・プロフィールを一括消去でき、さらに TRIGGER 権限から他会社の操作の中で任意の関数を所有者権限で走らせられた**ため、閉じない（0419 は「既存のテーブルは対象外」と明記しており、仕様 KR-4 も同じ書き方。この除外が穴になっている）。人材基盤の中核（persons, groups, jobs, job_shifts, job_roles, job_applications）には、越境・消去・直接書込・トリガ差込のいずれも届かなかった。

### Finding の状態

| ID | Severity | 状態 | 根拠（要約） |
|---|---|---|---|
| SEC-001 | High 8.3 | **open**（範囲を拡大して再評価） | 新6表は TRUNCATE が拒否（T01〜T07, T18）。既存 40 表は anon/authenticated に TRUNCATE・TRIGGER が残り、`truncate shifts / leave_requests / daily_reports / jyoban_reports / notices / app_profiles` が成功、他会社の SECURITY DEFINER 関数の中で一時関数のトリガが postgres 権限で実行された（X07〜X09, 第3A章） |
| SEC-002 | High 7.1 | **closed** | job_applications への INSERT/UPDATE/DELETE/ON CONFLICT/MERGE/COPY/FOR UPDATE が全て permission denied（anon・authenticated・運営ユーザーの 3 主体で W01〜W09）。継承・ビュー・テーブル作成・GRANT・トリガ無効化・RLS 無効化・session_replication_role も拒否。CASCADE 経由の削除も 0414 のガードが止める（W10, W11） |
| SEC-004 | Medium 6.5 | **closed** | シフト 367 件・他の勤務 1,001 件で invalid_input（366 / 1,000 は処理）。上限での最悪値は 1 呼び出し約 0.7〜0.9 秒（初回は 4,000 件で 24 秒）。残る集計の負荷は新規 SEC-018（Low） |
| SEC-007 | Medium 5.3 | **closed** | consentJointUse / workAllowed が "false"・0・null・undefined・[] のとき invalid_input（初回は eligible=true）。null の構造体による TypeError は fail-closed のため、新規 SEC-019（Low）に分離 |
| SEC-008 | Medium 5.3 | **closed** | 別グループの人の紐づけを INSERT / UPDATE / ON CONFLICT DO UPDATE / MERGE / COPY / company_id の付け替えの全てで拒否（G01〜G10）。存在しない人と他グループの人でエラー文言が同一（存在確認の oracle なし）。残る穴（既存行の遡及検査なし・事後のグループ変更）は新規 SEC-020（Low） |
| SEC-012 | Medium 4.7 | **closed** | `pnpm audit` に brace-expansion の助言が 0 件。pnpm-lock は 2.1.7 / 5.0.12。input-core に届く High / Critical は 0 件（残るのは glob・minimatch の moderate 3 件、開発時のみ） |
| SEC-003 | Medium 6.5 | open | 変更なし（0418 の新関数は他社・他グループを読ませない: P01〜P10）。Sprint 9 の REQ-040 / OQ-22 待ち |
| SEC-005 | Medium 6.5 | open | `update jobs set needs_boundary_check=false, status='published'` が自社の権限で通る（J04）。REQ-034b（Sprint 9）待ち。0416 の日本時間・0417 の空白判定は動作（J01〜J03）。空白判定の抜けは新規 SEC-021 |
| SEC-006 | Medium 5.4 | open | 変更なし。**仕様に未登録**（下記） |
| SEC-009 | Medium 4.9 | open | 変更なし。OQ-12a/b/c と REQ-035b は登録済みだが、未来日・撤回時刻・チャネル・履歴は未登録 |
| SEC-010 | Medium 4.3 | open | 変更なし（search_candidates に件数・頻度の制限なし） |
| SEC-011 | Medium 4.4 | open | 変更なし |
| SEC-014 | Medium 4.3 | open | DB の文字列長は無制限のまま。TS は件数の上限が入ったが、50 万字級の personId を含む 2,000 人の整列に 13 秒（`compareCodePoints` が比較ごとに配列化）。employments・annualFiscalYears の件数の上限は無い |
| SEC-013 | Low 3.3 | open | 変更なし（KR-2、運用で番号順に 1 回） |
| SEC-015 | Low 3.1 | open | 変更なし |
| SEC-016 | Low 3.1 | open | listRenewals の不正な基準日で、1,000 万字の入力が例外メッセージにそのまま入る |
| SEC-017 | Low 3.1 | open | トリガ関数 6 本（staff_guard_person_group を含む）に PUBLIC の EXECUTE。直接呼ぶと "trigger functions can only be called as triggers" で悪用不可（G15）。app_company_has_person が残る。FORCE RLS は persons ほかに無い |
| SEC-018 | Low 3.7 | **new** | 件数の上限内でも listApplicableJobs の合計が job 数に比例（上限いっぱいで 20 件 16 秒）。employments の件数に上限が無い（100 万件×366 シフトで 1.1 秒） |
| SEC-019 | Low 3.1 | **new** | person.employments / guardTraining / residence、job.shifts、busy の null・非配列が invalid_input でなく TypeError。job の isSecurityWork・needsBoundaryCheck・form の型・値を検証しない（未定義・0・null は「該当なし」として通る） |
| SEC-020 | Low 3.1 | **new** | 0420 は既存行を遡及して検査せず、persons / companies の group_id の事後変更で不整合ができる（運営のみ）。不整合の検出クエリが運用手順に無い |
| SEC-021 | Low 3.1 | **new** | 線引き確認者の空白判定が不完全（U+2800 点字空白、U+3164 ハングル填字、U+00AD、U+115F、U+180E、U+200E/F など。DB の 0417 と TS の両方）。全角空白・NBSP・ゼロ幅は拒否される |

### 公開前の必須条件（再監査後）

初回の 9 項目のうち、**SEC-002, 004, 007, 008 は閉じた**。残る必須条件は次の 5 項目。

1. **SEC-001**（High 8.3）人材基盤の新6表だけでなく **既存の全テーブル（40 表）** から anon / authenticated の TRUNCATE・REFERENCES・TRIGGER を取り消し、`alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated` を運用手順に入れる。実在の接続（server/src/db/pool.ts は `postgres://app_client@…` の直接接続）で authenticated 相当の SQL を実行できる経路があるため、PostgREST に限った話ではない。
2. **SEC-003**（Medium 6.5）会社に属する全ロールが自社の全員の PII を読め候補検索を呼べる（KR-5 / OQ-22 / OQ-19 / OQ-20 / REQ-040）。
3. **SEC-005**（Medium 6.5）警備・線引き・派遣の統制が会社の自己申告で回避できる（KR-3 / OQ-21 / REQ-034b）。再監査でも `needs_boundary_check` の付け替えが通ることを確認。
4. **SEC-006**（Medium 5.4）監査証跡が無い（仕様に未登録。KR か REQ を立てる）。
5. **SEC-009**（Medium 4.9）共同利用の同意（OQ-12a/b/c、REQ-035b）。

加えて、運用条件として次を維持する。
- 画面・API から `job_applications` へ書き込む機能は、REQ-039 の RPC が入るまで存在しない（0419 で権限は閉じた。再監査で迂回できないことを確認）。
- OQ-12a/b/c を弁護士の確認で確定するまで、REQ-035b（同意の取得）と共同利用の運用を開始しない。
- OQ-22 / OQ-19 / OQ-20 を決め、REQ-040 の許可表を DB の権限に反映するまで persons を画面に出さない。
- OQ-16（媒体の応募取り込み）は実装前に入力検証・取り込み元の認証・同意と保存期間を設計し再監査する。**仕様の OQ-16 にはこの再監査の条件が書かれていない**ので追記する。
- `pnpm audit` はリポジトリ全体で critical 4 / high 5 / moderate 16 / low 1（初回は 32 件、critical 4 / high 9）。いずれも apps/desktop（vite, vitest, tinypool）や server（proxy-addr, body-parser, xlsx, source-map-js）側で、**input-core には届かない**。Gate 3 の推移的依存の要件を Sprint 全体に適用するなら DevOps に回付する（INFO-4 を更新）。

### 仕様 v2.26（v2.25 の文面是正版）への登録状況

| 必須条件 | 仕様での登録 | 判定 |
|---|---|---|
| SEC-001 | KR-4 に登録済みだが「既存のテーブルは対象外」と書かれ、TRUNCATE・TRIGGER の対象を新6表に限っている | **不足**（既存 40 表を対象に含め、TRIGGER を明記する） |
| SEC-002 | KR-1 と REQ-039（RPC 化、0419）に登録・整合済み | 十分 |
| SEC-003 | KR-5、OQ-22、OQ-19/20、REQ-040 | 十分 |
| SEC-005 | KR-3、OQ-21（解決）、REQ-034b（Sprint 9） | 十分（実装は Sprint 9。J04 で未実装を確認） |
| SEC-006 | KR・OQ・REQ のいずれにも無い | **漏れ**（PII の参照・変更・候補検索の記録と、`created_by` 等の自己申告の検証を KR か REQ に登録する） |
| SEC-009 | OQ-12a/b/c、REQ-035b（代理記録なし・RPC のみ）、ヘッダの着手条件 | 概ね十分（`consent_at` の未来日の禁止、撤回時刻、チャネル、版の履歴は未登録） |
| OQ-16 の再監査 | OQ-16 はあるが再監査の条件が無い | **漏れ** |
| SEC-010, 011, 014, 015, 017 | 無し（必須条件ではない） | 任意（バックログ） |

---

### 再監査の判定の要約（Gate 3）

- Critical: **0**　High: **1**（SEC-001）　Medium: **7**　Low: **8**　（closed: SEC-002, 004, 007, 008, 012）
- RLS: 全テーブルで ENABLE ROW LEVEL SECURITY（app_profiles, app_site_credentials, app_site_members は試験連鎖では RLS 無効=INFO-1。FORCE は既存の一部のみ）
- クロスユーザーアクセス: 越境 0 件（第3章に加え、0418 の関数・0420 のトリガで P01〜P10, G01〜G18）
- Secrets: 0 件（9818be4 以降の差分の追加行を 14 パターンで走査）　プロトタイプ汚染: 遮断
- **Gate 3: 不合格（High 1 件）。** 差し戻し先は ⑥ Database Engineer（SEC-001 の範囲拡大、006, 020）、⑧ Generator（SEC-014, 018, 019, 021）。


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

## 2. Finding 一覧（初回。再監査後の状態は冒頭の「Finding の状態」表と各詳細の「再監査」行を参照。新規 SEC-018〜021 は末尾に追加）

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

## 3A. 再監査で実行した攻撃と結果

使い捨て DB `sec_re`（検証後に削除。`tln_rls` も削除）。データは 3 グループ・3 社・3 人（うち 1 人は同意なし）・案件 1・応募 1。実行主体は A1 社管理者（company_admin）、B1 社管理者、運営（platform_admin）、anon、プロフィールなしの認証ユーザー。各攻撃はトランザクション内で実行し rollback した（状態を変えない）。リポジトリの `run_talent_rls_check.sh` も全 PASS（87 項目）。「ERR」は防げたこと、「OK」は攻撃が成功したことを示す。

### A. 権限の取り消し（0419）の迂回（SEC-001 / SEC-002）

| # | 攻撃 | 主体 | 結果 |
|---|---|---|---|
| T01〜T04 | `truncate persons` / `truncate persons cascade` / `truncate only persons` / `truncate table persons restart identity cascade` | authenticated, anon | ERR permission denied for table persons（防げた） |
| T05, T06, T18 | `truncate job_applications` / `truncate groups cascade` / `truncate job_roles cascade` | 同上 | ERR（防げた） |
| T07 | `truncate jobs, job_shifts, job_applications`（複数表の構文） | 同上 | ERR（防げた） |
| T08〜T11 | `truncate staff cascade` / `truncate companies cascade` / `truncate sites cascade` / 参照する表を全て列挙して `truncate staff, shifts, …, job_applications` | 同上 | ERR permission denied for table job_applications または jobs（CASCADE が新6表に届くため全体が失敗。**新6表を介して既存表が消える経路は閉じた**） |
| **T12〜T17** | **`truncate shifts` / `leave_requests` / `daily_reports` / `jyoban_reports` / `notices` / `app_profiles`（既存表）** | **authenticated, anon** | **OK（TRUNCATE TABLE）。`select count(*) from shifts` は 0。全会社の行が消える。SEC-001 を閉じられない理由** |
| W01〜W09 | job_applications への INSERT / UPDATE / DELETE / INSERT … ON CONFLICT DO UPDATE / DO NOTHING / MERGE / SELECT FOR UPDATE / COPY FROM | authenticated, anon, 運営ユーザー | すべて ERR permission denied（防げた。3 主体とも） |
| W10, W11 | job_shifts / jobs の削除による ON DELETE CASCADE で応募を消す | 同上 | ERR（0414 のガード「応募のあるシフト／案件は削除できません」が効く） |
| W12 | job_shifts.company_id を他社に付け替え | 同上 | ERR（親一致トリガ） |
| W13, W14, W15 | `create view`、`create table … inherits (job_applications)`、`create temp table … inherits` | 同上 | ERR（public に CREATE 権限なし／所有者でない） |
| W16 | `grant all on job_applications to authenticated`（自分への付与） | 同上 | 無効（WARNING: no privileges were granted） |
| W18〜W22 | `set session_replication_role=replica`、`alter table … disable trigger / disable row level security`、`drop policy`、関数の作成 | 同上 | ERR（権限なし・所有者でない） |
| W17 | `set role postgres` | — | 試験の接続が superuser のため成立（**無効な試験**。実運用では authenticator は postgres に SET ROLE できない。結果から除外） |
| — | PUBLIC への付与の残り | — | 6 表の ACL から PUBLIC は消えている。他スキーマ・ビュー・マテビューに anon/authenticated の権限は無い（0 件） |
| — | SECURITY DEFINER 関数のうち新6表に書くもの | — | 書き込みを行うのは検証用トリガ（直接呼べない）のみ。`search_candidates` は読み取りのみ。ほかに job_applications / persons を更新する関数は無い |
| **X01, X02** | **既存表 staff / shifts に、既存のトリガ関数で `create trigger`** | **authenticated, anon** | **OK（CREATE TRIGGER）。永続化すると全会社の staff / shifts の書込を失敗させられる（DoS）。X04 job_applications と X03 persons は ERR** |
| **X07, X09** | **一時関数 `pg_temp.tf()` を作り staff / shifts にトリガとして設定** | **authenticated** | **OK。別セッションの B1 社管理者が `company_set_staff_phone()` を呼ぶと、`WARNING: TRIGGER FN RUNS AS postgres (session_user postgres)`。他会社の SECURITY DEFINER 関数の所有者権限でコードが実行される（権限昇格）。攻撃者の接続が開いている間のみ有効（切断で自動削除）** |
| — | 後から作られるテーブルの既定の権限 | — | `pg_default_acl` は依然 `anon=arwdDxt, authenticated=arwdDxt`。0419 は既存の 6 表だけ。Sprint 9 以降の新しい表は再び TRUNCATE・TRIGGER・REFERENCES が付く |
| — | 権限の取り消しの有無 | — | TRUNCATE が無い表: groups, job_shifts, job_roles, persons, jobs, job_applications の 6 つだけ。ほか 40 表は全て有り（TRIGGER も 40 表） |

### B. 0420（staff.person_id のグループ一致）

| # | 攻撃 | 結果 |
|---|---|---|
| G01 | B1 社の staff に A グループの人を UPDATE で紐づけ | ERR 人と雇用先の会社が同じグループに属していません（防げた） |
| G02 | 同上を INSERT | ERR（防げた） |
| G03 | 同じグループの人を紐づけ | OK（正常） |
| G04 | 存在しない person_id | ERR（防げた。他グループの人と同一文言=存在確認の oracle なし。G18） |
| G05 | group_id が未設定の会社に人を紐づけ | ERR（防げた） |
| G06 | 紐づけ済みの staff の company_id を別グループの会社に変更 | ERR（防げた） |
| G07, G08 | INSERT … ON CONFLICT DO UPDATE SET person_id / MERGE の UPDATE | ERR（防げた） |
| G09 | COPY staff（BEFORE ROW トリガも COPY で発火） | ERR（防げた） |
| G10 | person_id を NULL にして別グループへ付け替え | ERR（防げた） |
| G11 | 不整合な既存行の無関係な列の更新 | OK（検査は person_id・company_id の更新時のみ。**遡及しない=SEC-020**） |
| G12, G13 | persons.group_id / companies.group_id を（運営権限で）事後に変更 | OK（不整合が 1 件できる。トリガは staff 側にしか無い=SEC-020） |
| G15 | トリガ関数の直接呼び出し | ERR trigger functions can only be called as triggers（authenticated, anon） |
| G16, G17 | authenticated / anon が staff に person_id を INSERT / UPDATE | ERR RLS 違反 / rows=0（FORCE RLS で会社の書込ポリシーなし） |

### C. 0418（app_company_person_ids）

| # | 攻撃 | 結果 |
|---|---|---|
| P01〜P03 | A1 / B1 / 運営 / 存在しない uid / anon で関数と persons を読む | A1→自社の 1 人、B1→自社の 1 人、運営→3 人、不明 uid→0 人、anon→ERR permission denied（防げた。会社なし=NULL で全件ヒットなし） |
| P04, P05 | ユーザー条件内のエラー（0 除算）で他社の行の値を推測 | 他社の行は評価されず漏れない（防げた。セキュリティバリアが効く） |
| P06 | 自作関数 `raise notice` を persons の条件に混ぜる | 通知は自社の行（pB1）のみ。他社の行は関数に渡らない（防げた） |
| P07 | `search_path=pg_temp,public` と pg_temp の `app_company_id()` の偽物で乗っ取り | 影響なし（関数は `set search_path = public, pg_temp`、スキーマ修飾の呼び出し） |
| P08 | persons と staff を exists で結合して他社の関係を探る | 0 件（防げた） |
| P10 | 他社の company_id で search_candidates | ERR 権限がありません（防げた） |
| SH01〜SH03 | authenticated が persons の同意を UPDATE / persons を INSERT / groups を UPDATE | rows=0 / ERR RLS 違反 / rows=0（防げた） |

### D. 0416 / 0417（線引き確認）

| # | 攻撃 | 結果 |
|---|---|---|
| J01, J02 | 確認日が日本時間の今日 / 明日 | 今日は OK、明日は ERR（0416 は動作） |
| J03 | draft→filled で確認なしに状態遷移 | ERR（0417 の published・filled の検査は動作） |
| BC | 確認者を NBSP / ゼロ幅 / EM SPACE にする | ERR（防げた） |
| **BC** | **確認者を U+2800（点字空白）/ U+3164（ハングル填字）/ U+00AD（ソフトハイフン）にする** | **OK（published で挿入できる。SEC-021）。TS の `boundaryRecorded` も同じ結果** |
| J04 | 自社の権限で `needs_boundary_check=false` に更新して公開 | OK（SEC-005 のまま） |

### E. TS の純粋関数（tsc で JS 化し Node 22 で実行）

| 攻撃 | 結果 |
|---|---|
| シフト 366 / 367 件、他の勤務 1,000 / 1,001 件 | 366・1,000 は処理、367・1,001 は invalid_input。validateJobForPublish も 367 で invalid_input（SEC-004: 防げた） |
| 上限いっぱい（366×1,000、未成年）の処理時間 | 0.7〜0.9 秒/回（初回は 4,000 件で 24 秒） |
| employments 100 万件 × 366 シフト | 1.1 秒（上限なし=SEC-018）。annualFiscalYears 100 万件×366 は 0.05 秒 |
| listApplicableJobs（上限いっぱいの案件 20 件） | 16.2 秒（案件数の上限なし=SEC-018） |
| consentJointUse: "false" / 0 / null / undefined / []、workAllowed: "false"、{}、birthDate にオブジェクト・Date | すべて invalid_input（SEC-007: 防げた） |
| residence: null、employments: null / [null]、guardTraining: null、shifts: null / undefined / 文字列 / [null]、busy: null / [null] / 配列でないもの、job: null、person: null | TypeError（fail-closed。eligible=true にはならない=SEC-019） |
| isSecurityWork: undefined、needsBoundaryCheck: 0 / null、form: 'x' / '__proto__' | 検証なしで通る（SEC-019）。"false" 文字列は truthy で fail-closed |
| employmentDays: "40" / NaN | invalid_input。1e308 は通る（30 日以内ではない扱い）。-0 は 0 日として日雇派遣 |
| `JSON.parse('{"__proto__":{"consentJointUse":true}}')` | no_consent のまま。`({}).consentJointUse` は undefined（汚染なし） |
| listRenewals([null]) / (null) / employments: null | TypeError（仕様 v2.25: 不正な人は TypeError。fail-closed） |
| listRenewals 10 万人 | 0.4 秒 |
| listRenewals 2,000 人 × 10 万字の personId の整列 | 13 秒（SEC-014 に追記） |
| listRenewals 基準日に 1,000 万字の文字列 | RangeError にその 1,000 万字が入る（SEC-016） |
| soonDays に NaN / Infinity / "30" | 例外なく処理（NaN は soon を出さない） |

### F. 依存関係と Secrets

| 項目 | 結果 |
|---|---|
| `pnpm audit --json` | 全体 26 件（critical 4 / high 5 / moderate 16 / low 1）。**brace-expansion は 0 件**（初回: input-core 経由で high 2）。pnpm-lock は 2.1.7 / 5.0.12、overrides は `brace-expansion@>=2.0.0 <2.1.7 → ^2.1.7`、`@>=4.0.0 <5.0.12 → ^5.0.12` |
| input-core に届く脆弱性 | glob 1 件・minimatch 2 件のみ（moderate、@vitest/coverage-v8 > test-exclude、開発時のみ）。High / Critical は 0 件 |
| 全体の critical / high | vitest・tinypool×2（critical、apps/desktop）、proxy-addr（critical）、vite・source-map-js・xlsx×2・body-parser（high）。input-core の範囲外 |
| Secrets 14 パターン | 9818be4 以降の追加行にヒット 0 件 |


## 4. Finding 詳細

### SEC-001　TRUNCATE ... CASCADE で全テナントの人・雇用・案件を一括消去できる（KR-4 の実測。影響は想定より広い）

**再監査（2026-11-08）: open（High 8.3、範囲を拡大）。** 0419 により新6表は TRUNCATE・TRIGGER・REFERENCES が拒否されるため、`truncate persons cascade` で staff 以下が消える初回の攻撃は防げた。しかし**既存 40 表は anon / authenticated に TRUNCATE・TRIGGER・REFERENCES が残り**、`truncate shifts / leave_requests / daily_reports / jyoban_reports / notices / app_profiles` が成功する（第3A章 T12〜T17）。さらに TRIGGER 権限から、既存のトリガ関数を staff / shifts に付けて全会社の書込を失敗させられ（X01, X02）、**一時関数のトリガを設定すると、他会社の管理者が SECURITY DEFINER の `company_set_staff_phone()` を呼んだ際に postgres 権限で実行された**（X07。C:H）。新しい表の既定の権限（pg_default_acl）も未変更。CVSS を `CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:C/C:H/I:H/A:H`（8.3）に更新。**修正案（追加）:** `revoke truncate, references, trigger on all tables in schema public from anon, authenticated, public;`（既存の表を含む。service_role／app_service に必要な権限は別途付与）と `alter default privileges … revoke truncate, references, trigger on tables from anon, authenticated;` を 0421 として追加し、仕様 KR-4 の「既存のテーブルは対象外」を削除する。

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

**再監査（2026-11-08）: closed。** 0419 で job_applications の INSERT / UPDATE / DELETE を anon・authenticated・PUBLIC から取り消し済み。ON CONFLICT DO UPDATE / DO NOTHING、MERGE、COPY、SELECT FOR UPDATE、継承、ビュー、GRANT、トリガ無効化、RLS 無効化を含む 20 種の攻撃を 3 主体（A1 管理者、anon、運営ユーザー）で再実行し、すべて permission denied または所有者でないとして拒否（W01〜W24）。CASCADE による応募の連鎖削除も 0414 のガードが止める。読み取りは RLS の下で残る（意図どおり）。

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

**再監査（2026-11-08）: open。** 0418 の `app_company_person_ids()` は自社の person のみを返し（P01）、他社・他グループ・anon には効かない（P01〜P10）。ロールの区別は未実装のまま。

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

**再監査（2026-11-08）: closed。** `MAX_SHIFTS=366` / `MAX_BUSY=1000` で invalid_input（367・1,001 件で確認）。上限での 1 呼び出しは 0.7〜0.9 秒（初回: 4,000 件で 24 秒）。件数の合計に比例する負荷は SEC-018（Low）として分離。

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

**再監査（2026-11-08）: open。** `update jobs set needs_boundary_check=false, status='published'` が自社の権限で通ることを J04 で確認。REQ-034b（Sprint 9）待ち。

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

**再監査（2026-11-08）: open。** 変更なし。

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

**再監査（2026-11-08）: closed。** "false"・0・null・undefined・[] の consentJointUse と workAllowed は invalid_input（初回は eligible=true）。null の構造体による TypeError は eligible を真にしない fail-closed のため SEC-019（Low）として分離。

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

**再監査（2026-11-08）: closed。** 0420 のトリガ（INSERT と UPDATE OF person_id, company_id）は、UPDATE・INSERT・ON CONFLICT DO UPDATE・MERGE・COPY・company_id の付け替え・NULL を経由した付け替えのいずれでも別グループの人を拒否（G01〜G10）。存在しない人と他グループの人で文言が同一で oracle にならない。トリガは SECURITY DEFINER で persons / companies を RLS なしに読むが、直接呼べない（G15）。残る穴は SEC-020。

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

**再監査（2026-11-08）: open。** 変更なし。

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

**再監査（2026-11-08）: open。** 変更なし。

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

**再監査（2026-11-08）: open。** 変更なし。

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

**再監査（2026-11-08）: closed。** `pnpm audit --json` に brace-expansion の助言が 0 件。input-core に届く High / Critical は 0 件（glob・minimatch の moderate 3 件のみ、開発時）。

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

**再監査（2026-11-08）: open。** 変更なし。

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

**再監査（2026-11-08）: open。** TS は件数の上限が入ったが、`compareCodePoints` が比較ごとに `Array.from` で配列化するため、10 万字の personId 2,000 人の整列に 13 秒。DB の文字列長の上限は無いまま。employments・annualFiscalYears の件数の上限も無い（SEC-018）。

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

**再監査（2026-11-08）: open。** 変更なし。

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

**再監査（2026-11-08）: open。** 不正な基準日（1,000 万字）が RangeError のメッセージにそのまま入る。

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

**再監査（2026-11-08）: open。** 新しいトリガ関数 `staff_guard_person_group` も PUBLIC に EXECUTE が付く（直接呼ぶと拒否=悪用不可）。`app_company_has_person` は authenticated に残る。

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


### SEC-018　件数の上限内でも合計の負荷に上限が無い（listApplicableJobs の案件数、employments の件数）

- **Severity:** Low　**CVSS v3.1:** 3.7　`CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:N/A:L`
- **OWASP:** A04:2021 Insecure Design（資源消費）
- **場所:** `packages/input-core/src/talent/eligibility.ts` 行 241-243（listApplicableJobs）、行 170-176（employments の走査）
- **関連:** REQ-026、SEC-004（残余）　**公開前の必須:** いいえ（API 層で件数を制限する前提）

**内容:** SEC-004 の是正で 1 呼び出しの上限は入ったが、`overlap` の判定が `shiftsOverlap` ごとに日付を再計算するため、上限いっぱい（366 シフト×1,000 件）で 0.7〜0.9 秒かかる。`listApplicableJobs` は案件数の上限を持たず、案件数に比例する（20 件で 16 秒）。`person.employments` と `annualFiscalYears` の件数にも上限が無い（employments 100 万件×366 シフトで 1.1 秒）。他の勤務（busy）は本人の応募履歴から作られ、会社の管理者が大量に増やせない現状では悪用は難しいため Low。

**再現手順と結果:**

```
checkEligibility(minor, job(366 shifts), busy(1000))                -> 0.73〜0.94 s
listApplicableJobs(adult, 20 jobs x 366 shifts, busy(1000))         -> 16.2 s
checkEligibility(person(employments=1e6), job(366 shifts))          -> 1.1 s
```

**修正案:** busy を日付ごとの Map に前処理し同日分だけと比較する。span() の結果を 1 回だけ計算する。listApplicableJobs・employments・annualFiscalYears に件数の上限（例: 案件 500、employments 200）を置き invalid_input にする。

### SEC-019　null・非配列の入力が TypeError になり、job のフラグの型・値を検証しない

- **Severity:** Low　**CVSS v3.1:** 3.1　`CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:L/A:N`
- **OWASP:** A03:2021 / A04:2021
- **場所:** `packages/input-core/src/talent/eligibility.ts` 行 146-159（入力検証）、行 134-138（jobInputInvalid）
- **関連:** REQ-026（SEC-007 の残余）　**公開前の必須:** いいえ

**内容:** SEC-007 の是正は boolean の型を検証したが、構造体が null・undefined・非配列のとき invalid_input でなく TypeError を投げる（person.employments / guardTraining / residence が null、job.shifts が null・文字列、busy が null・配列以外、job・person が null）。eligible を真にしないので fail-closed だが、API が 500 を返し、1 件の不正なデータで一覧全体が失敗する（listApplicableJobs）。また job の `isSecurityWork` / `needsBoundaryCheck` / `form` / `employerCompanyId` は型も値も検証せず、undefined・0・null は「警備でない」「確認不要」として通る（"false" 文字列は truthy で fail-closed）。DB は NOT NULL の boolean だが `needs_boundary_check` は NULL を許す（coalesce で false 扱い）。

**再現手順と結果:**

```
checkEligibility(person({residence:null}), job())            -> THROWS TypeError (reading 'workAllowed')
checkEligibility(person({employments:null}), job())          -> THROWS TypeError
checkEligibility(person(), job({shifts:null}))               -> THROWS TypeError
checkEligibility(person(), job({isSecurityWork:undefined}))  -> {"eligible":true}   （警備の判定が適用されない）
checkEligibility(person(), job({needsBoundaryCheck:0}))      -> {"eligible":true}
checkEligibility(person(), job({form:'x'}))                  -> {"eligible":true}
```

**修正案:** 入口で構造体の存在と型（Array.isArray、typeof）を検証して invalid_input にする。job のフラグは boolean、form は列挙値、employerCompanyId は文字列であることを検査する。`needs_boundary_check` は NOT NULL default false にする。

### SEC-020　0420 は既存行を遡及して検査せず、persons / companies のグループ変更後の不整合を検出しない

- **Severity:** Low　**CVSS v3.1:** 3.1　`CVSS:3.1/AV:N/AC:H/PR:H/UI:N/S:U/C:L/I:N/A:N`
- **OWASP:** A01:2021 / A04:2021
- **場所:** `supabase/migrations/0420_talent_staff_person_group.sql` 行 22-24
- **関連:** SEC-008（残余）、REQ-035　**公開前の必須:** いいえ

**内容:** トリガは `staff` の `person_id`・`company_id` の変更時にだけ発火する。(1) 0420 の適用前に不整合な行があっても拒否も報告もされず、無関係な列の更新は通る（G11）。(2) 運営が `persons.group_id` や `companies.group_id` を後から変えると不整合ができ、persons の参照ポリシーが他グループの人を会社に見せる（G12, G13: 不整合 1 件）。変更できるのは運営（platform_admin）のみで、使い捨て DB のデータには適用前の不整合は無かった。

**再現手順と結果:**

```
update persons set group_id='<別グループ>' where id='<A1 に雇用されている人>';   -- => UPDATE 1（運営）
select count(*) from staff s join persons p on p.id=s.person_id join companies c on c.id=s.company_id
 where c.group_id is distinct from p.group_id;                                        -- => 1
```

**修正案:** 本番に適用する前に上記の検出クエリで 0 件を確認し、運用手順に定期的な実行を入れる。persons.group_id と companies.group_id の更新を、紐づく雇用があるあいだは拒否するトリガにする（または group_id を不変にする）。

### SEC-021　線引き確認者の空白判定が不完全（見えない文字で「確認者あり」にできる）

- **Severity:** Low　**CVSS v3.1:** 3.1　`CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:L/A:N`
- **OWASP:** A04:2021 Insecure Design
- **場所:** `supabase/migrations/0417_talent_boundary_status_space.sql` 行 32-34、`packages/input-core/src/talent/eligibility.ts` 行 76-83
- **関連:** REQ-034a、SEC-005　**公開前の必須:** いいえ（自己申告の統制そのものは SEC-005）

**内容:** 空白の判定は「空白の一覧を除いて空か」（ブラックリスト）で、一覧にない見えない文字を確認者に入れると「確認者あり」になる。会社の管理者は元から任意の文字列（例: "x"）を入れられるため新しい権限昇格ではないが、画面で空欄に見える確認者のまま公開でき、確認の記録の意味が失われる。

**再現手順と結果:**

```
insert into jobs(..., status, needs_boundary_check, boundary_confirmed_by, boundary_confirmed_on)
 values (..., 'published', true, E'\u2800', '2026-11-01');   -- => INSERT 0 1（U+3164, U+00AD も同じ）
checkEligibility(person(), job({needsBoundaryCheck:true, boundaryCheck:{confirmedBy:'\u2800', confirmedOn:'2026-01-01'}}))  -- => eligible:true
-- 拒否されるもの: NBSP, U+2003, U+200B（既存の一覧）
```

**修正案:** ブラックリストをやめ、確認者に文字・数字（Unicode の L / N カテゴリ）が 1 文字以上あることを要求する（DB は `~ '[[:alnum:]]'` か `\p{L}\p{N}` 相当、TS は `/[\p{L}\p{N}]/u`）。

## 5. 既知のリスク（KR）と Open Questions の評価

| 項目 | CVSS での評価 | 対応する Finding | 公開前の条件 |
|---|---|---|---|
| KR-1 応募テーブルの直接書き込み | High 7.1 → **解消（SEC-002 closed）** | SEC-002 | 0419 で権限取消済み。RPC は Sprint 9 の REQ-039 |
| KR-2 マイグレーションの再適用 | Low 3.3 | SEC-013 | ランナーの履歴管理（運用）。実測で旧版に戻ることを確認 |
| KR-3 警備フラグと職種 | Medium 6.5 | SEC-005 | form=security の職種を DB で強制。OQ-21 と同時に |
| KR-4 TRUNCATE 権限 | High 8.3（**新6表は解消、既存 40 表に残存=SEC-001 open**） | SEC-001 | 仕様の「既存のテーブルは対象外」を外す。TRIGGER 権限も取り消す（他会社の操作で任意の関数が所有者権限で動いた） |
| KR-5 候補検索と PII の範囲 | Medium 6.5 | SEC-003 | OQ-22 の決定と DB 反映 |
| OQ-12a/b/c 共同利用の項目・書面・通知文と版 | Medium 4.9（法令対応の未確定として必須扱い） | SEC-009 | 弁護士の確認、同意の記録の拡充、責任者の公表 |
| OQ-16 媒体の応募取り込み | 未実装のため評価対象外 | — | 取り込み実装前に再監査（**仕様の OQ-16 に再監査の条件を追記する**） |
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
- **INFO-4** `pnpm audit` はリポジトリ全体で critical 4 / high 5 / moderate 16 / low 1（再監査時。初回は 32 件で critical 4 / high 9）。vitest・tinypool・vite・proxy-addr・body-parser・xlsx・source-map-js が apps/desktop と server 側にある。input-core には届かないため本監査の件数に含めない。DevOps に回付する。

## 8. Gate 3 への報告

**再監査後（2026-11-08）:** Critical: **0**　High: **1**（SEC-001）　Medium: **7**　Low: **8**。**Gate 3: 不合格。** 詳細は冒頭の「再監査の結論」。差し戻し先は ⑥ Database Engineer（SEC-001 の範囲拡大=既存 40 表と既定の権限、SEC-006, 020）、⑧ Generator（SEC-014, 018, 019, 021）。SEC-001 を 0421 で閉じた後に再々監査（既存表の TRUNCATE・TRIGGER・REFERENCES が 0 になること、Sprint 9 の新しい表に権限が付かないこと）を行う。

**（参考）初回:** Critical: 0　High: 2（SEC-001, SEC-002）　Medium: 11　Low: 4。Gate 3: 不合格。
