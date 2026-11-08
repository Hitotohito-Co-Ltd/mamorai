# Sprint 8 searchLog

# 第8回（⑫ Adversary 鵜飼 玄 / Fresh Context）

再現物の置き場: `/tmp/claude-0/-home-user-mamorai/aed01a01-0a13-54ef-8461-b3a0d55630da/scratchpad/adv8/`（リポジトリには置かない）。作った DB（adv8、変異用 tln_rls_m0〜m3、runner の tln_rls）は全て削除済み。
評価対象のコミット: feat/talent-foundation @ 304fc27。評価中に ⑪ 再監査（c06675f）と仕様 v2.26/v2.27（8627afc, 304fc27）が入ったが、コード・マイグレーション・テストは 3063bae と同一（差分は spec と security-findings のみ）。仕様は v2.27 を正として照合した。

## 0. ベースライン（変異を入れる前に確認）
- input-core 全体: 42 ファイル 1069 件 PASS（s8 637 + purity 1）。tsc --noEmit エラー 0。`src/talent` カバレッジ Stmts 100 / Branch 99.53 / Funcs 100 / Lines 100（未到達は eligibility.ts:118 の分岐）。
- `supabase/tests/run_talent_rls_check.sh`: all PASS。実行出力の番号は 1〜87 から 32 を除いた **86 シナリオ**（MANIFEST は 77、green-phase-8 は 87 と記載 → FIND-807）。
- 変異用コピー（scratch mut/base）でも s8+purity 638 件 PASS を確認してから変異を入れた。SQL 変異は runner のコピー（DB 名だけ差し替え）で、ベースラインの all PASS を先に確認。

## 1. D1 仕様照合（REQ 単位）
- 独立オラクル（仕様だけから書き直した checkEligibility。実装を見ずに近い形で再実装し、reasons・warnings・details を突合）と実装の差分ファズ: 300,000 件（security/dispatch/spot/referral、0〜3 シフト、日またぎ、夜間、18歳境界、在留 0〜60 日・期限切れ、日雇派遣の例外区分、busy、線引き）で差分 0。理由コードの出現数を確認し、全 15 種類の理由・警告・eligible=true が現れることを確認（偏りで無意味になっていない）。validateJobForPublish も同じファズで差分 0。
- listRenewals の独立オラクル（在籍中の定義、現任教育の対象外条件、コードポイント順の並び、種別順、soonDays 0/7/30/45、personId に é・Ａ・😀・空文字）と 20,000 件で差分 0。
- 発見: 新任教育の修了日が不正で今年度の現任済みのとき、仕様は無条件に invalid 項目を返すとしているが実装は返さず、テスト（s8:3853-）もその挙動を固定している → FIND-801。
- 確認者の空白集合: 0417 の正規表現を実ファイルから抽出し、DB 側で U+0001〜U+10FFFF を全走査して除去される集合を求め、JS の `[\s\u3000\u200B-\u200D\u2060\uFEFF]` と全コードポイントで比較。差分 0（DB ロケールは C.UTF-8。他のロケールでは `\s` が追加の文字に当たるかもしれないが、手元では en_US 等の確認ができない → 評価できなかった点）。
- 計測要件（REQ-026/027/031/032/033 のイベント）は API 実装時（Sprint 9 以降）で、Sprint 8 の実装対象外として扱った（第7回 FIND-010 と同じ整理）。

## 2. 攻撃シナリオ（DB。Supabase 既定相当）
連鎖: 0000_base_assumed, 0100, 0102, 0103, 0200, 0201, 0202, 0400, 0401, 0402, 0406〜0420（`build.sh adv8`。alter default privileges で anon/authenticated に ALL）。本番の 0300 相当（app_profiles の RLS 有効＋自己参照のみ）を追加して実行（指定の連鎖には 0300 が無く、そのままだと会社管理者が自分の app_profiles を書き換えて運営になれる。検証環境の限界であり Sprint 8 の欠陥ではない）。
ユーザー: A 社・A2 社（同一グループ G1）、B 社（G2）、company_admin、company_manager、会社なしの admin、プロフィールなし、platform_admin、anon。
- attack1b.sql の結果（全て防御成功）:
  - A 社管理者: persons は自社の 1 人のみ、search_candidates(A) は同意済みの 2 人（A 社・A2 社）、search_candidates(B 社) は拒否、job_applications は 0 件見える。
  - 書込: persons の UPDATE/INSERT（RLS で 0 件・拒否）、staff の INSERT（RLS 違反）、staff.person_id の付替え（0 件）、companies.group_id の更新（0 件）、groups INSERT 拒否、app_profiles の role 更新（0 件）・INSERT 拒否。
  - jobs: 他グループの職種・警備×派遣・職種なし派遣・他社名義・他社の現場を拒否。他社の案件の UPDATE/DELETE は 0 件。他社の案件へのシフトは company=A でも company=B でも拒否（トリガ／RLS）。
  - job_applications: INSERT・UPDATE・DELETE・SELECT FOR UPDATE は全て permission denied（0419）。
  - TRUNCATE: job_applications・persons・groups・job_roles は permission denied。`truncate staff cascade`・`companies cascade`・`sites cascade`・`jyoban_slots cascade` は、連鎖先に job_applications・jobs・job_shifts があり permission denied（0419 の取消が連鎖先の検査で効く）。anon の `truncate staff cascade` も同様に拒否。
  - 会社なし admin・プロフィールなし: persons 0 件、search_candidates 拒否、jobs 0 件。anon: persons 参照は関数 app_company_person_ids の permission denied、search_candidates 拒否、jobs・apps は 0 件、INSERT は RLS 違反。company_manager は persons 1 件・search_candidates 可（KR-5 の記述どおり）。
  - platform: persons 4 件全件。
- KR 記述と実態の照合: KR-1（書込手段が無い）= 一致。KR-4（既存表に TRUNCATE が残る）= 一致（authenticated の `truncate app_profiles` が成功し、プロフィールが全消去されることを実測。KR-4 は OQ-23 で既知）。KR-5 = 一致。KR-7 の『運営が group_id を後から変えると不整合』= 一致（companies.group_id を更新すると staff の紐づけとの不整合が 1 件できる。platform のみ可）。
- 0420 の挙動確認: group が NULL の会社への紐づけは拒否、紐づけ済みの雇用を他グループの会社へ付け替える UPDATE は拒否（正規実装）。
- 結論: 越境・権限昇格・情報漏えいは再現できなかった。Critical/High なし。

## 3. 変異テスト（TS）
- 自動変異 323 件（eligibility.ts と renewal.ts。比較演算子・論理演算子・算術・`!`・数値定数・.some/.every・Math.min/max・reasons.add/out.push の削除・if の return 削除を 1 箇所ずつ。`mut/mutate.py`）: 304 検出、19 生存。
- 生存 19 件の内訳: 同値 18（`new Date(0)`→`new Date(1)`（全ての日付で同じだけずれて差が変わらない）、KIND_RANK の residence の値、compareCodePoints の `d<0`→`d<=0`・符号の大きさ・長さ等しい場合の `<`→`<=`、`basicDoneOn <= referenceDate`→`<`（同日なら同年度で pending=false）、rank の expired/soon/invalid/ok の値（順序は daysLeft の符号で決まる）、eligibility.ts:118 のデッドコード）。**同値でない生存は 1 件**: compareCodePoints の最後の戻り値 `-1 : 1`→`-1 : 0` → FIND-802（入力順依存の誤った並びを実行で再現）。
- 実装側の穴は上記 FIND-801 のみ。

## 4. 変異テスト（SQL）
- 自動変異 417 件（0410〜0420。比較・論理・NULL 判定・coalesce・定数・raise の削除・security definer→invoker・トリガの insert/update・revoke/grant のコメントアウトなど）: 0419/0420 の 15 件（15 中 14 検出、1 生存=security invoker）と 0410〜0418 の 402 件（168 検出、234 生存）。
- 手書き変異 25 件（0419 の 17: 各権限・各テーブル・各ロール・応募の INSERT/UPDATE/DELETE を 1 つずつ外す、SELECT まで取り消す。0420 の 8: トリガのイベント／列、group NULL の扱い）: 0419 は **全 17 件が FAIL 行またはシナリオの実行エラーで検出**。0420 は 8 件中 4 件生存。同値は 2（persons.group_id が NOT NULL のため `v_person_group is null` の削除は同値、変更の無い UPDATE を飛ばす変異は同値）。**実質の穴 2 件**: トリガを `update of person_id` のみにする（company_id の付替えが通り、B 社管理者に他グループの人が見える）／会社の group_id が NULL の紐づけを許可 → FIND-803。
- 0410〜0418 の生存 234 件の仕分け: 後続のマイグレーションで `create or replace` により置き換えられる旧版（jobs_guard_security_dispatch の 0410〜0416 版、search_candidates の 0411 版、persons_company_read の 0410/0413 版、job_shifts_guard_company の 0412 版）の変異は最終状態に影響しないため除外。`select 1` の定数、`if not exists (select …)` の包み、defaults などは同値または既知（FIND-006）。残る実質の穴: CHECK 制約の境界（FIND-804）、勤務枠・グループ・職種の正常系（FIND-808）、jobs_guard_delete の冗長（FIND-809）、0417:22・0418 の ACL は第7回 FIND-002/003 のまま未是正。
- `security definer`→`security invoker` の変異は全て生存するが、テストはトリガを所有者として実行するため原理的に検出できない（本番の呼び出し主体は authenticated／service_role）。これはテスト環境の限界として評価できなかった点に記載。

## 5. D4 構造・後方互換
- マージベース 9180bc5 からの既存ファイルの変更: package.json（pnpm.overrides）、packages/input-core/src/index.ts（export 3 行）、vitest.config.ts（coverage に talent）、pipeline-state.json（追記）、pnpm-lock.yaml（brace-expansion 2.1.4→2.1.7、5.0.9→5.0.12 の 2 件）、spec。既存のマイグレーションは無変更。
- `npm view` で brace-expansion@2.1.7 と 5.0.12 が実在し、lock の integrity が一致することを確認。`pnpm install --frozen-lockfile --lockfile-only` は web-push の specifier 不一致で失敗するが、マージベースの lock でも同じ失敗（本ブランチ起因ではない）。overrides 自体は frozen の検査に影響しない。
- export * の衝突: tsc エラー 0。純粋性テスト（禁止 API）は変異ではなく既存の通り PASS。
- デッドコード・重複: FIND-806、FIND-809。

## 6. D5 テスト品質
- 弱いアサーション（toBeTruthy/toBeDefined）は s8 に 0 件。it.skip/only なし。
- 新規 24 件（TypeError の仕様）と 40 件（型・上限・古い年）は変異で検出される（renewal.ts の古い年の計算は utcMs の変異が検出された）。
- NFR-05 の負荷: 1,000 人×7 項目で 46 ms。personId を 2,000 文字の共通接頭辞にした極端な入力では 1,013 ms（compareCodePoints が比較ごとに配列を作る）。実在の ID（UUID 36 文字）では問題ないため Finding にせず記録のみ。

## 7. D6
- LLM 機能なし → N/A（talent 配下と 0410〜0420 に LLM 呼出しなし）。

## 8. 既知で Finding にしなかったもの
- KR-7: 件数上限なし（employments は上限が無く 20 万件でも 170 ms で動作）、null・配列でない入力の TypeError（guardTraining 欠落・null 要素・busy が配列でない場合を実測。listApplicableJobs は 1 件の不正な案件で全体が失敗）、0420 の遡及なし、不可視文字（U+200E/00AD/3164 などで確認者あり扱い）。
- KR-4/OQ-23: 既存表の TRUNCATE/TRIGGER。
- KR-3/OQ-21: 警備フラグの職種依存。KR-5/OQ-22: ロール別の制限。

## 9. 評価できなかった点
- DB の文字クラス `\s` の他ロケール（本番の en_US.UTF-8 等）での挙動。手元は C.UTF-8 のみ。
- `security definer` の取り違えの検出（テストが所有者で実行されるため）。
- 本番の Supabase のロール属性（postgres が BYPASSRLS を持つこと等）と、テーブルの所有者が migrations の実行者と一致するか（revoke が効くか）。
- Sprint 9 の RPC（登録・同意・応募）は未実装のため、同意なしの人を同一グループ内の別会社の雇用に紐づける経路（0420 は同一グループなら許可）は、書込を行うサーバ側の実装が無く評価不能。


---

# 以下は第7回の searchLog（履歴として保持）

# Sprint 8 searchLog（⑫ Adversary 第7回 / Fresh Context）

再現物の置き場: `/tmp/claude-0/-home-user-mamorai/aed01a01-0a13-54ef-8461-b3a0d55630da/scratchpad/adv7/`（リポジトリには置かない）。作った DB（adv7a/adv7b/adv7c、変異用 sm*/rr*、リポジトリ runner の tln_rls）は全て削除済み。

## 0. ベースライン（変異を入れる前に確認）
- `pnpm vitest run`（input-core 全体）: 42 ファイル 1005 件 PASS。s8 は 573 件 + t1 純粋性 1 件。tsc --noEmit エラー 0。`src/talent` カバレッジ Stmts 100 / Branch 99.51 / Funcs 100 / Lines 100（MANIFEST・green-phase-7 の記載と一致）。
- `supabase/tests/run_talent_rls_check.sh`: 77 シナリオ all PASS（番号 1〜78、32 は欠番。MANIFEST と一致）。
- 変異用コピー（scratch の mut/w1〜w4）でもベースライン 574 件 PASS を確認してから変異を実行（最初のコピーは tsconfig と、中断した変異の残りで失敗したため、作り直して再確認）。

## 1. D1 仕様照合（REQ 単位）
- REQ-026〜033、境界の確定（WHEN 形）の全項目を実装と突合。probe.test.ts / probe2.test.ts（scratch）で 50 超の入力を実行。18 歳の前日と当日、2/29 生まれ、22:00 終了と 22:01 終了、05:00 開始と 04:59 開始、24 時間勤務、60/61 日、8 時間 1 分、日またぎ通算、派遣 30/31 日、例外区分、soonDays=0/負、基準日の年度境界。仕様どおり。
- 確認者の空白集合: 0417 の正規表現を実ファイルから抽出し、DB 側で U+0001〜U+FFFF を全走査して除去される集合（29 点）を得て、JS の `\s|　|[​-‍⁠﻿]` と一致することを確認（差異なし）。
- 発見: REQ-034a の『応募の拒否（TS と DB）』は DB 側に実装がない（attack3.sql: 線引き未確認の draft/closed 案件へ confirmed の応募が INSERT できた）。KR-1 の列挙に無い → FIND-005。
- 計測要件のイベント（REQ-026/027/031/032/033）は実装・テストなし（grep で spec 以外にヒットなし）。発火点が Sprint 9 以降の API → FIND-010 に併記（Low）。

## 2. 攻撃シナリオ（DB。Supabase 既定相当: anon/authenticated に ALL、関数の既定 EXECUTE）
連鎖: 0000_base_assumed, 0100, 0102, 0103, 0200, 0201, 0202, 0400, 0401, 0402, 0406〜0418（`mkdb.sh adv7a`）。ユーザー: A 社・A2 社（同グループ）・B 社（別グループ）の company_admin、platform_admin、会社なし（role=guard, company_id=null）、グループ未設定の会社の管理者、anon。
- attack1.sql（結果は全て防御成功）:
  - A 社管理者の persons は自社の 2 人のみ。search_candidates(A) は同意済みの 2 人（A 社・A2 社）。A2 社 ID・NULL は拒否。
  - persons の UPDATE（同意フラグの書換）は 0 件、INSERT は RLS 違反。staff.person_id の付替え・companies.group_id の付替えは 0 件。groups・job_roles への INSERT は拒否、job_roles.is_security の UPDATE は 0 件。
  - 会社なしユーザー: persons 0 件、search_candidates 拒否。グループ未設定の会社: 0 件。anon: persons 参照・search_candidates・app_company_person_ids・app_company_has_person すべて permission denied（persons 参照は空ではなくエラーになる点は仕様外の挙動）。
  - 運営: persons 5 件全件、search_candidates は任意の会社 ID で可、app_company_person_ids は 0 件。
  - 0418 の新関数 app_company_person_ids は引数なしで呼び出し元の会社の person だけ返す。他社の人は返らない。
- attack2.sql: 警備×派遣（INSERT/UPDATE の form 変更/role 変更/role を null）を拒否、他グループの職種・他社の現場・職種なし派遣を拒否、draft の needs=true を false にして公開する抜け道は仕様上の Sprint 9 事項（KR-3/OQ-21）、ただし published で needs=true に戻すと拒否、closed を挟んでも published には戻せない、シフトの他社名義・負の単価・不正な時刻を拒否、他社スタッフの応募を拒否、応募のある案件・シフトの削除を拒否、KR-1 の記述どおり応募を DELETE すると案件も削除できた、B 社管理者は A 社の案件・シフト・応募を読めず UPDATE/DELETE も 0 件。
- 実測: `truncate persons cascade`（authenticated, B 社）で staff・shifts・staff_sites・jyoban_*・job_applications まで連鎖して空（staff 6→0）。KR-4 は権限取消の対象を『新テーブル』とするだけで、既存表への連鎖範囲は書かれていない → FIND-010(4)。
- 0300 の有無: 指定された連鎖には 0300（app_profiles の RLS）がなく、その連鎖では会社管理者が自分の app_profiles.company_id を書換えて他社になれる。0300 を足すと RLS で止まる（scratch で確認）。Sprint 8 の変更ではなく検証環境の限界。評価できなかった点として報告。
- 結論: 越境・権限昇格・情報漏えいは再現できなかった。Critical/High なし。

## 3. 変異テスト（TS）
- 自動変異 327 件（eligibility.ts 219 / renewal.ts 108。比較演算子・論理演算子・算術・`!`・数値定数を 1 箇所ずつ）: 288 検出、39 生存。生存 39 件は全て同値（TS の非 null 表明 `!` の削除、`new Date(0)`→`new Date(1)` で日差が変わらない、renewal.ts の rank の ok/expired/soon 値（ok は filter 後で到達不能、expired/soon は daysLeft の符号で順序が決まる）、compareCodePoints の戻り値の大きさ、長さ等しい場合の `<`→`<=`、`basicDoneOn <= ref`→`<`（同日なら同年度で pending=false のため同値））→ FIND-009 の根拠。
- 手書き変異 134 件（reasons.add の削除 10、警告・details、例外区分 4 種、正規表現の各要素、invalid_input の各節、在籍の every→some、日雇派遣・年齢・夜間・警備教育・在留・重なり・通算・listApplicableJobs・validateJobForPublish・renewal の各節）: 124 検出、10 生存。同値 8（`　` と `﻿` は `\s` に含まれる、typeof ガードは配列以外で等価、isRealDate の年・月・日の各検査は他の 2 つと冗長、`Math.round`→`floor` は UTC 日で整数）。**実質の生存は 2 件**: (1) 夜間判定をシフト単位にする変異 → FIND-004、(2) invalid_input の戻りに警告を入れる変異（契約に warnings の規定がなく、Low として FIND-006 に含めず記録のみ）。
- 実装の欠陥として: renewal.ts の utcDay が `Date.UTC` で 0〜99 年を誤る（変異ではなく実測）→ FIND-007。退社済み×不正な契約満了日の優先順位が未定義 → FIND-008。
- 純粋性テスト（t1 と s8-P1/P2）: 禁止 API の混入は検出されることを手書き確認はせず、変異 327+134 の中で `Date.now` 等の変異は対象外。純粋性は今回の主戦場でないため追加探索なし。

## 4. 変異テスト（SQL）
- 方法: マイグレーションに 1 箇所ずつ変異を入れたコピー（または最終状態に破壊的ポリシーを足す `9999_mut.sql`）で、runner と同じ連鎖（各 2 回適用）→ `talent_rls_check.sql` を実行。検出条件: FAIL 行、またはシナリオの実行エラー。ベースラインは 77 シナリオ all PASS。
- 110 変異: 68 検出、41 生存、1 件は適用失敗（410-app-unique、変異の作りが悪く無効）。
- 生存 41 件の仕分け:
  - 同値・重複防御で実害なし（除外）: 412-sc-null（platform+NULL は空集合）、412-sc-revoke-public（0411 の revoke が残る）、417-secdisp-coalesce・417-needs-coalesce（NULL 評価が同値）、418-null（IN と NULL は同値）、413-shiftguard-secdef・410-comp-check-true-job_shifts/job_applications・410-plat-check-true-job_shifts/job_applications（親一致トリガが同じ結果）、414-jobdel-guard・414-jobdel-join（カスケードするシフトの削除トリガが止める）、410-status-jobs・410-appstatus（変異値 'x' が追加されただけ）、410-needs-default（安全側）。
  - 実質の穴: 410-plat-check-true-groups/job_roles、post-persons-update-policy、post-persons-delete-policy、post-staff-person-update、post-roles-insert、post-roles-update、post-groups-insert、post-companies-update-group → FIND-001。417-secdisp → FIND-002。418-anon、418-public、418-searchpath → FIND-003。410-consent-default、410-persons-group-notnull、410-form-list、410-placement、410-emptype-*、410-left-after-hired、410-roles-unique、414-days、417-status-closed、413-hasperson-company、413-hasperson-revoke 系 → FIND-006（Low）。
- 影響の実測: post-companies-update-group の状態（A 社管理者が companies.group_id を更新可能）では search_candidates が別グループの『p5B』を返した（adv7c）。

## 5. 追加のみ方針（後方互換）
- `git diff main --name-status`: 既存ファイルの変更は index.ts（export 追加のみ）、vitest.config.ts（coverage の include に src/talent/** を追加）、pipeline-state.json、spec/behavioral-spec.md のみ。マイグレーションは全て新規（0410〜0418）、既存表への変更は列追加（NULL 許容）と CHECK（新列のみ対象）、`add constraint` は名前を調べて追加。破壊的 DDL なし。RenewalItem の型（urgency に 'invalid'、daysLeft に null）は仕様に沿った追加で、参照元はテストのみ。
- KR-2（再適用で旧版に戻る）の記述は実態と一致（0410 の jobs_guard と persons_company_read、0411 の search_candidates が旧版）。

## 6. ドキュメントと実態
- MANIFEST: 仕様版（v2.21）、DB 連鎖（0413 まで）、s8 件数（231）が古い。→ FIND-010。
- spec/security-report.md（評価中に出現）の SEC-003/SEC-015 の場所『0418…:289-300』は実ファイル（19 行）に存在しない（複数ファイルを連結した行番号とみられる）→ FIND-010(6)。同報告の SEC-008 は staff.person_id の群一致を検査しない件で、現状は staff に会社の書込ポリシーがなく到達不能なことを自分でも確認（post-staff-person-update が生存する点は FIND-001）。
- KR-1・KR-3・KR-5 の記述は実測と一致。KR-4 は FIND-010 参照。
- spec/evidence の件数（1005・573・77・Branch 99.51）は一致。

## 7. D6
- LLM 機能なし → N/A。

## 評価できなかった点
- 実際の Supabase（PostgREST・JWT・postgres が BYPASSRLS を持つ環境）での実行。auth.uid() は GUC のスタブで再現。
- 0300 を含む本番の完全な連鎖（指定の連鎖に含まれず、含めると RLS が app_profiles に付く）。
- 『今日（日本時間）』の検証は実行時刻に依存し、now() を固定できないため境界の再現は限定的（green-phase-7 の既知の限界と同じ）。
- 変異の網羅は演算子・定数・主要条件の 1 箇所ずつで、全ての論理変異ではない。
