# Sprint 8 性能報告（人材基盤）

担当: ⑬ Performance Engineer（早瀬 隼）　計測日: 2026-11-08　対象: ブランチ feat/talent-foundation（HEAD 9818be4）

> **画面指標は適用外。** Sprint 8 は画面を持たない基盤層（TypeScript の純粋関数と PostgreSQL のマイグレーション・RLS）。
> Lighthouse・Core Web Vitals（LCP/CLS/INP）・バンドルサイズ・レスポンシブは計測しない。宣言: `spec/evidence/sprint-8-gate-applicability.md`（Orchestrator、RYUGEN 選択）。
> 代わりに NFR-05（1,000 人分の更新手続き一覧 < 1 秒）、判定関数のコスト、DB の実行計画を計測した。この宣言は Sprint 8 に限る。画面を含む Sprint ではこの代替は使えない。

## 結論

| 項目 | 判定 | 数値 |
|---|---|---|
| **NFR-05**: 1,000 人分の `listRenewals` < 1 秒 | **PASS（余裕 約 56 倍）** | 3 パターンとも最大 17.9 ms（最悪ケース）。中央値は 7.3〜10.9 ms |
| `listRenewals` のスケール | 問題なし | 1,000→5,000→20,000 人で 約 4〜6 倍ずつ（ほぼ線形）。20,000 人でも最大 347 ms |
| `checkEligibility` の通常入力 | 問題なし | シフト 1・busy 0 で 6 µs。シフト 10・busy 100 で 約 2.5 ms |
| `checkEligibility` の極端入力（シフト 1,000 × busy 1,000） | **秒単位に悪化**（1.86〜2.08 秒） | 計算量は O(シフト数 × busy 数) で確認。1 組あたり 約 1.9 µs |
| `listApplicableJobs`（案件 1,000 件） | busy が 100 を超えると遅い | busy 0: 8 ms / busy 100: 312 ms / busy 1,000: 3.5 秒（案件あたり 1 シフト）、8.6 秒（3 シフト） |
| DB: `search_candidates`（persons 10,000） | 問題なし | 関数呼び出し 12 ms（10,000 人中 7,000 人を返す） |
| DB: **`persons_company_read` ポリシー** | **ボトルネック** | persons 10,000 件の SELECT が 約 350 ms（ポリシーなしの基準は 0.5〜0.8 ms。約 500 倍）。行数に比例 |
| DB: RLS 付きの `job_shifts` / `job_applications` | 同種の問題（軽度） | 6,000 件で 約 40 ms、30,000 件で 約 190 ms |
| DB: インデックスの欠落 | 軽微（現規模では実害なし） | 後述の指摘 P-3〜P-5 |

**推奨（優先順）**
1. P-1（Medium）: `persons_company_read` の判定を行ごとの関数呼び出しにしない形に直す。書き換え案を scratch DB で試した結果は 約 75〜108 ms（約 4 分の 1）で、完全な解決ではない（後述）。persons が数万件になる前に、⑥ Database Engineer が設計を見直す。
2. P-2（Low→Medium）: `checkEligibility` の busy 側の日付・時刻の解釈を、案件ごと・呼び出しごとにやり直さない。`listApplicableJobs` は busy を 1 回だけ検証・日付で索引化して使い回す。
3. P-3〜P-5（Low）: 索引は現規模では不要。更新手続きを DB 側で引く Sprint 9 以降に `staff(contract_end_on)` の扱いを決める。

## 1. 計測条件

| 項目 | 内容 |
|---|---|
| マシン | 4 コア（`nproc` = 4）、Linux 6.18、Node v22.23.4、PostgreSQL 16.15（同一マシンの使い捨てサーバ） |
| 負荷（開始時）| `uptime` load average 0.08, 0.06, 0.02（TS 計測開始時 03:25）、DB 計測開始時 0.48, 0.52, 0.25 |
| 負荷（終了時）| load average 0.58, 0.55, 0.27（03:30）。`ps` 上で他のエージェントの重い処理（CPU 使用率の高いプロセス）は無し。最上位は claude 本体の 3.6% |
| 注意 | 負荷の 1 分値は計測中に 0.5〜0.8 まで上がったが、これは本計測自体（Node の単一スレッド）による。他プロセスの影響は確認されなかった |
| ビルド種別 | 画面なし。TS は `tsc`（`--target es2022 --strict`）で JS にコンパイルして `node` で実行（開発サーバは使っていない）。DB は本番と同じ連鎖でマイグレーションを適用 |
| TS 計測 | `performance.now()` で `listRenewals` 1 呼び出しの時間。同一入力を **10 回**（1 回目=JIT 前の初回を含む）。最小・中央値・最大を採用。基準日 2026-11-08、`soonDays` 既定 30 |
| 分散 | 最大−最小が中央値の 15% を超えた。主因は 1 回目（JIT 前）。10 回に増やした上で、1 回目を除いても超える条件がある（例: 20,000 人の worst は 281〜347 ms）。判定は余裕が 50 倍以上あるため結論に影響しない |
| 判定値 | 全パターンの最大値（最悪の 1 回）を NFR-05 の判定に使う |
| `checkEligibility` の計測 | 1 呼び出しあたりの µs。反復数を自動調整（50 ms 以上かかる回数）し、その反復を 7 回測って最小・中央値・最大 |
| DB | 使い捨て DB `perf_s8_scratch`（計測後に削除済み）。`run_talent_rls_check.sh` と同じ順序でマイグレーション 0000〜0417 を適用（2 回適用の冪等確認は省略し 1 回のみ）。`jyoban_supabase_stub.sql` と、anon/authenticated の既定権限付与も同じ。データ投入は `session_replication_role = replica`（トリガを止めて高速投入） |
| DB の件数 | groups 1、companies 20、persons 10,000（同意 70%）、staff 12,000（全員に person_id、2 割は 2 社目の雇用）、jobs 2,000、job_shifts 6,000、job_applications 30,000。`analyze` 済み |
| DB の実行 | 各クエリを `EXPLAIN (ANALYZE, TIMING OFF)` で **6 回**（1 回目が初回）。RLS の確認は `set role authenticated` と `request.jwt.claim.sub` で会社 1 の管理者として実行（会社 1 が見える persons は 500 人） |
| 制約 | メモリリーク検査・API の p95 は対象外（API なし・長時間動作の処理なし）。前スプリントの報告は無い（Sprint 8 が初回）ので回帰比較なし。persons は 10,000 件のみで測っており、それ以上は比例の推定 |

## 2. NFR-05: `listRenewals`（REQ-033）

入力: 人は 1 人あたり雇用 1〜3 件、契約満了日・新任/現任教育・在留期限を持つ。ID は UUID 形式の文字列（並べ替えで文字列比較が走る）。

- **realistic**: 雇用 1〜3 件（最後以外は退社済み）、契約満了日あり 50%、警備員 60%（現任修了済み 60%）、在留カード 10%。出力は約 10%（1,000 人で 102 件）。
- **worst**: 全員が 3 項目とも出力に入る（期限切れ契約、現任未達、在留期限 10 日以内）。1,000 人で 2,000 件、20,000 人で 40,000 件。
  - 注: 在留の期限日は `i % 25 - 5` 日後で、一部は期限切れ側。現任教育は基準日が 11 月なので期限 3/31 までの日数は 143 日で 30 日を超えるため出力に入らない（そのため 3 項目ではなく 2 項目/人）。「全員が出力に含まれる」条件は満たす。
- **best**: 全員が除外（契約満了は 200 日以上先、現任修了済み、在留は 100 日以上先）。出力 0 件。

結果（ms、10 回、1 回目は JIT 前の初回）:

| パターン | 人数 | 出力件数 | 1 回目 | 最小 | 中央値 | 最大 |
|---|---|---|---|---|---|---|
| realistic | 1,000 | 102 | 16.14 | 9.30 | 10.44 | 16.14 |
| realistic | 5,000 | 508 | 56.82 | 41.30 | 42.65 | 56.82 |
| realistic | 20,000 | 2,132 | 205.12 | 174.77 | 185.78 | 205.12 |
| worst | 1,000 | 2,000 | 17.88 | 9.70 | 10.94 | **17.88** |
| worst | 5,000 | 10,000 | 101.92 | 63.91 | 69.89 | 101.92 |
| worst | 20,000 | 40,000 | 321.72 | 281.53 | 296.51 | 346.98 |
| best | 1,000 | 0 | 11.49 | 5.83 | 7.34 | 11.49 |
| best | 5,000 | 0 | 43.01 | 31.38 | 40.30 | 62.34 |
| best | 20,000 | 0 | 149.73 | 115.50 | 128.34 | 149.73 |

- NFR-05（1,000 人 < 1,000 ms）: 最悪の 1 回で 17.88 ms。**余裕は約 56 倍。PASS**。
- スケール: 人数 5 倍で 4.1〜6.4 倍、20,000 人まで 4 倍で 4.0〜4.4 倍（realistic の 1,000→20,000 は 17.8 倍で人数の 20 倍より小さい）。O(n log n) の範囲で、急な悪化は無い。
- best（全員除外）でも 1,000 人で 7 ms かかる。時間の大半は出力の並べ替えではなく、各日付の検証（`isRealDate` の正規表現と `Date` 生成）。出力が 0 件でも人数に比例してかかる点に留意（ボトルネックではない）。

## 3. 判定関数のコスト（`eligibility.ts`）

### 3-1. `checkEligibility`（1 呼び出しあたり、µs、中央値。最小〜最大の幅は raw 参照）
警備業務・security 形・全条件を満たす人（早期に失敗しない）。busy はどのシフトとも重ならない時間帯に置いた（重なると `some` が早期終了して軽くなるため、最悪側）。distinct = シフトが別々の日、sameDay = 全シフトが同じ日。

| シフト数 | busy 0 | busy 100 | busy 1,000 |
|---|---|---|---|
| 1（distinct） | 6.3 | 277 | 2,697 |
| 10（distinct） | 75 | 2,549 | 18,844 |
| 100（distinct） | 476 | 18,470 | 245,209 |
| 1（sameDay） | 10.9 | 504 | 4,524 |
| 10（sameDay） | 49 | 2,473 | 25,213 |
| 100（sameDay） | 450 | 23,329 | 191,966 |

- **極端入力**: シフト 1,000 × busy 1,000 は distinct で **1,857 ms**（最小 1,780 / 最大 1,949）、sameDay で **2,083 ms**（最小 1,926 / 最大 2,389）。**秒単位に悪化する**（約 1.9〜2.1 µs × 100 万組）。
- 計算量は **O(シフト数 × busy 数)** で確認: busy を 10 倍にすると約 10 倍（1 シフトで 277→2,697 µs）、シフトを 10 倍にしても約 10 倍（busy 1,000 で 2,697→18,844 µs）。
- 参考: busy の全てがシフトに重なる場合（シフト 100 × busy 1,000）は 14.4 ms と軽い（`some` が最初の一致で止まるため）。重ならない側が最悪。
- 主因（`packages/input-core/src/talent/eligibility.ts`）: `shiftsOverlap` が呼ばれるたびに `span()` が日付文字列を分解して `Date.UTC` を再計算する（`busy.some((b) => shiftsOverlap(b, s))`、およびシフトごとの再走査）。加えて `dailyHours(busy, d)` が日付ごとに busy 全件を `filter` する。いずれも busy の解釈は 1 回で済むのに、組ごとにやり直している。
- 現実的な入力（シフト 10 以下・busy 100 以下）では 2.5 ms 以下で問題なし。

### 3-2. `listApplicableJobs`（案件 1,000 件、ms、中央値）

| 案件あたりシフト | busy 0 | busy 100 | busy 1,000 |
|---|---|---|---|
| 1 | 8.4 | 312 | 3,517 |
| 3 | 19.8 | 810 | 8,559 |

- busy が 100 件までなら 1 秒未満。busy 1,000 は 3.5〜8.6 秒（案件数 × シフト数 × busy 数に比例）。
- 追加の無駄: `checkEligibility` は呼び出しのたびに busy 全件の `isRealDate`/`isRealTime`（正規表現）を検証する。`listApplicableJobs` では案件 1,000 件分だけ同じ busy を 1,000 回検証している（busy 1,000 件で 100 万回の検証）。
- 1 人の busy が 1,000 件になるかは未確定（現実の想定は数十件）。想定を超えたときの上限として記録する。

## 4. DB（PostgreSQL 16、persons 10,000・staff 12,000・jobs 2,000・shifts 6,000・applications 30,000）

実行時間は 6 回の範囲（初回を含む）。詳細な計画は再現ログ `db_results.txt`。

| クエリ | ロール | 計画 | 実行時間 |
|---|---|---|---|
| `search_candidates` の内部 SQL（会社 1 のグループ、同意あり） | superuser | persons を **Seq Scan**（7,000 行返す）→ ソート。`idx_persons_group` は使われない（同グループが全員のため、選択度が無く Seq Scan が妥当） | 5.6〜7.9 ms |
| `search_candidates('会社1')` 関数呼び出し | authenticated | 関数内で同じ SQL | 11.8〜13.6 ms |
| `persons` 全件 SELECT（`persons_company_read`） | authenticated | **Seq Scan、Filter: `app_is_platform() OR app_company_has_person(id)`**。9,500 行を除外。buffers 53,412 | **329〜469 ms**（500 行返す） |
| `count(*) from persons` | authenticated | 同上 | 331〜617 ms |
| 同じ `select * from persons` | superuser（RLS なし） | Seq Scan | 0.48〜0.80 ms |
| `persons` を id 1 件 | authenticated | Index Scan（persons_pkey） | 1.0〜1.9 ms |
| `persons` の group_id + consent | superuser | Seq Scan（7,000 行） | 1.0〜2.2 ms |
| `persons` の名前前方一致 | superuser | **Seq Scan**（`name` に索引なし。100 行） | 0.85〜1.7 ms |
| `staff` を person_id | superuser | Index Scan（idx_staff_person） | 0.06〜0.08 ms |
| `staff` を person_id + company_id（`app_company_has_person` の中身） | superuser | Index Scan（idx_staff_person） | 0.05〜0.07 ms |
| `staff` を company_id | superuser | Bitmap Index Scan（idx_staff_company）。500 行 | 0.44〜0.63 ms |
| `staff` を company_id + 在籍（left_on is null） | superuser | 同上 | 0.46〜1.65 ms |
| `staff` を contract_end_on 範囲 | superuser | **Seq Scan**（532 行） | 1.5〜4.0 ms |
| `jobs` を company_id + status | superuser | Bitmap Index Scan（idx_jobs_company_status） | 0.06 ms |
| `jobs` を status のみ | superuser | **Seq Scan**（800 行） | 0.31〜1.27 ms |
| `jobs` 全件 | authenticated | Seq Scan（RLS: `app_is_platform() OR company_id = app_company_id()`）、100 行 | 11.5〜22.8 ms |
| `job_shifts` を job_id | superuser | Bitmap Index Scan（idx_job_shifts_job） | 0.10〜0.13 ms |
| `job_shifts` を company_id | superuser | **Seq Scan**（300 行） | 0.40〜0.57 ms |
| `job_shifts` を work_date 範囲 | superuser | **Seq Scan**（714 行） | 0.47〜1.16 ms |
| `job_shifts` 全件 | authenticated | Seq Scan（RLS）、300 行 | 38〜54 ms |
| `job_applications` を staff_id + status | superuser | Bitmap Index Scan（idx_job_apps_staff） | 0.07〜0.09 ms |
| `job_applications` を job_shift_id | superuser | Bitmap Index Scan（一意制約の索引 job_shift_id, staff_id の先頭列） | 0.09〜0.12 ms |
| `job_applications` を company_id | superuser | **Seq Scan**（1,500 行） | 2.1〜3.2 ms |
| `job_applications` 全件 | authenticated | Seq Scan（RLS）、1,500 行 | 172〜201 ms |
| busy 取得（応募 → シフト JOIN、staff_id 指定） | superuser | idx_job_apps_staff → job_shifts_pkey の Nested Loop | 0.08〜0.15 ms |

**主要な読み取り（人の検索・応募の確認・busy 取得）は、索引を使っている**（staff の person_id/company_id、jobs の company+status、job_shifts の job_id、job_applications の staff_id と job_shift_id）。N+1 を起こすアプリ側のコードは Sprint 8 に無いため、N+1 の判定は対象外。

### RLS の行ごとコスト
- `persons`: 約 35 µs/行 × 全 10,000 行（見える 500 行ではなく、全行に対して `app_is_platform()` と `app_company_has_person(id)` が呼ばれる）。計画に `Filter: (app_is_platform() OR app_company_has_person(id))`。外から見える件数が少なくても、persons 全体の件数に比例して遅くなる。推定（未測定）: 50,000 件で約 1.7 秒、100,000 件で約 3.5 秒。
- `job_shifts`: 約 7 µs/行（6,000 行で 40 ms）、`job_applications`: 約 6 µs/行（30,000 行で 190 ms）。同じ構造。
- 補足: 同時に `company_id = app_company_id()` の RLS 条件が `app_is_platform() OR ...` と OR で結ばれるため、`company_id` に索引を足してもプランは変わらなかった（scratch で `job_shifts(company_id, work_date)` と `job_applications(company_id, status)` を試した結果: 34〜46 ms、166〜251 ms で改善なし）。

### scratch DB での仮説検証（リポジトリは未変更）
- `persons` のポリシーを `exists (select 1 from staff s where s.person_id = persons.id and s.company_id = (select app_company_id()))` に差し替えた場合: 71〜108 ms（初回 2,105 ms の外れ値あり。原因未特定）。現行 321〜391 ms から約 4 分の 1。`app_is_platform()` がプラットフォーム用ポリシー側で行ごとに呼ばれる分が残るため、これ以上は別の工夫が要る。本番での採用可否は検証が必要（セキュリティ側の確認も要る）。

## 5. 指摘事項

| ID | 重大度 | 内容 | 超過幅 / 根拠 | 対象 | 提案（想定改善幅） |
|---|---|---|---|---|---|
| P-1 | **Medium** | `persons_company_read` が行ごとに `app_company_has_person(id)`（security definer 関数）と `app_is_platform()` を呼ぶ。persons 全体の件数に比例して SELECT が遅くなる。persons 10,000 件で 350 ms（基準 0.5〜0.8 ms）。 | 会社 1 が見えるのは 500 人なのに 10,000 行すべてを評価（buffers 53,412）。数万件で秒単位 | `supabase/migrations/0413_talent_hardening2.sql`（ポリシーと関数） | ポリシーを関数呼び出しでなく `exists` の相関サブクエリ + `(select app_company_id())` にする（試算 約 4 分の 1。⑥ と ⑪ の確認が必要）。それでも足りない場合は、可視判定を持つ別表（会社×人）の導入を検討 |
| P-2 | Low（busy 1,000 を想定するなら Medium） | `checkEligibility` は O(シフト × busy)。1,000 × 1,000 で 1.86〜2.08 秒。`listApplicableJobs` は busy 1,000 で 3.5〜8.6 秒。busy の検証・日付解釈を呼び出しごとに繰り返している | 1 組 約 1.9 µs。現実的な入力（busy ≤ 100）では 0.3〜0.8 秒以下 | `packages/input-core/src/talent/eligibility.ts`（`shiftsOverlap`/`span`/`dailyHours`、入力検証） | busy を日付で索引化して先に 1 回だけ検証・変換し、同日と前日のものだけを比較（O(S+B) に近づく）。`listApplicableJobs` は busy の検証を 1 回にまとめる。実装は ⑧/⑨（私は書き換えない） |
| P-3 | Low | `job_shifts.company_id`、`job_applications.company_id` に索引がない。会社単位の一覧や集計は全表走査。ただし RLS の条件が OR 結合のため、索引だけでは RLS 付きの SELECT は速くならない（実験済み） | job_shifts 6,000 件で 0.4〜0.6 ms、job_applications 30,000 件で 2〜3 ms（現規模では許容） | 0410 | 会社単位の集計を画面に出す Sprint で必要なら追加。RLS の速度は P-1 の書き換えとセットで対応 |
| P-4 | Low | `job_shifts.work_date` に単独の索引がない（`idx_job_shifts_job` は job_id 先頭）。日付範囲での案件検索は Seq Scan | 6,000 件で 0.5〜1.2 ms | 0410 | 日付で案件を探す画面（Sprint 9 以降）の前に、`jobs`/`job_shifts` の検索条件を確定してから決める |
| P-5 | Low | `staff.contract_end_on` に索引がない。DB 側で期限範囲を引くと Seq Scan。現状の `listRenewals` は TS 側で処理するため影響なし | 12,000 件で 1.5〜4.0 ms | 0410 | 更新手続きを DB で抽出する設計にするときのみ検討 |
| P-6 | 情報 | `persons.name`（検索条件）に索引がない。名前の前方一致は Seq Scan。`search_candidates` は `p.name` でソートするが、全件取得のため索引は効かない | 10,000 件で 約 1 ms | — | 絞り込み（`p_filter`）が実装される Sprint 9 以降に検討 |

致命的（Critical/High）な性能問題は無い。NFR-05 は満たしている。`search_candidates` は問題なし（10,000 人・20 社で 12 ms）。

## 6. 再現手順

スクリプトは `/tmp/claude-0/-home-user-mamorai/aed01a01-0a13-54ef-8461-b3a0d55630da/scratchpad/perf/` にある（リポジトリには置いていない）。

```
cd /home/user/mamorai/packages/input-core
node_modules/.bin/tsc --outDir $P/out/talent --module nodenext --moduleResolution nodenext --target es2022 --strict --skipLibCheck \
  src/talent/model.ts src/talent/eligibility.ts src/talent/renewal.ts
echo '{"type":"module"}' > $P/out/package.json          # P = 上記 perf ディレクトリ
cd $P
for pat in realistic worst best; do for n in 1000 5000 20000; do node bench_renewal.mjs $pat $n 10; done; done   # → renewal_results.jsonl
node bench_elig.mjs                                      # → elig_results.jsonl（約 4 分）
# DB（PGPASSWORD=x PGHOST=127.0.0.1 PGPORT=5432、停止中なら pg_ctlcluster 16 main start）
#   1) create database perf_s8_scratch、jyoban_supabase_stub.sql と既定権限付与、
#      run_talent_rls_check.sh と同じ順序で 0000〜0417 を適用
#   2) psql -d perf_s8_scratch -f seed.sql
#   3) bash db_queries.sh > db_results.txt
#   4) bash exp_hypo.sh（仮説検証。ポリシーを書き換えるので scratch 専用）
#   5) drop database perf_s8_scratch
```

生ログ: `renewal_results.jsonl`（全回の ms を含む）、`elig_results.jsonl`、`db_results.txt`（全クエリの計画と 6 回の時間）、`exp_hypo_results.txt`。

後始末: `perf_s8_scratch` は削除済み（確認済み）。リポジトリで変更したのは本ファイルのみ。コミットはしていない。


---
## 追記（2026-11-08）P-1 への対応
- `persons_company_read` を、行ごとの関数呼び出しから、自社の person の集合を1回だけ求める形（`app_company_person_ids()`）に変更（`0418_talent_persons_rls_perf.sql`）。
- 同じ構成（persons 10,000・staff 10,000・会社20・見える行500）で全件 SELECT の実行時間: 変更前 513.7 ms → 変更後 42.7 ms（約12倍速）。見える行数は変更前後とも 500 で、可視性の意味は変えていない。
- DB 検証 77 シナリオは all PASS（0418 を含めて各2回適用）。
- P-2〜P-6 は Low で、現規模では影響なし。busy を数百件以上にする使い方が出たら、busy の日付索引化（P-2）を行う。
