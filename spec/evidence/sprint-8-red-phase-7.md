# Sprint 8 RED Phase Evidence 第7回（仕様 v2.21）

実行日時: 2026-11-07
TDD-Writer: 赤松 灯 (⑦)
再生成の記録: spec/evidence/sprint-8-test-regeneration.md（第8回）
コマンド: pnpm --filter @mamorai/input-core exec vitest run
実装（eligibility.ts / renewal.ts）は読まずに作成。落ちるテストは落ちたまま（緩め・skip・todo なし）。

## 結果
new-feature-tests: FAIL
  s8_talent_req026_034.test.ts: 573 件中 32 FAIL / 541 PASS（新規 137 のうち 32 RED・105 PASS）

regression-baseline: PASS
  全体: Test Files 1 failed | 41 passed (42)／Tests 32 failed | 973 passed (1005)
  第7回までの既存 868 件は全て PASS。回帰 0 件。

## FAIL 一覧（32 件。実装が v2.21 に未追随。テストは緩めていない）
1. 夜間勤務の導出（REQ-030 / FIND-602）10 件
   nightWork=false の 17 歳が、22:00-23:00 / 21:00-22:30 / 04:00-06:00 / 20:00-06:00 / 00:00-05:00 / 12:00-22:01 / 04:59-12:00 / 09:00-09:00（24 時間）、および複数シフトのうち 1 つ（最初・2 つ目）が夜間にかかる案件でも eligible=true（期待: under_age）。実装は nightWork の値だけを見ており、シフト時刻から導出していない。
2. annualFiscalYears が配列でない（REQ-033 / FIND-603）19 件
   - checkEligibility（警備案件 6 + 非警備案件 6 = 12 件）: undefined / キー欠落 / null / 文字列 / 数値 / オブジェクト。警備案件では TypeError（Cannot read properties of undefined (reading 'includes')）、非警備案件では invalid_input が出ない。
   - listRenewals（6 + 複数人 1 = 7 件）: 一覧全体が例外で失敗する（期待: その人は annual_training の invalid 項目、dueOn=年度末。他の人は通常どおり）。
3. 古い年の日付（REQ-026/037 / FIND-606）3 件
   生年月日 '0099-01-01'・'0000-01-01'、入社日 '0099-01-01' が invalid_input になる（期待: 暦に存在するので有効）。0100-03-01 は PASS のため、100 年未満の年の扱いに限った欠陥。

## PASS（105 件。実装が既に満たしている。変異の生き残りへの固定として残す）
- 夜間: 夜間にかからない境界（05:00-22:00 / 09:00-17:00 / 05:00-12:00 / 12:00-22:00 / 05:01-21:59）、nightWork=true、18 歳、誕生日当日、全日中の複数シフト
- annualFiscalYears: 配列（空配列を含む）の対
- 空白の集合（REQ-034 / FIND-608）: U+00A0 / 1680 / 2000〜200A / 2028 / 2029 / 202F / 205F / 3000 と混在（公開前・応募とも）、可視文字を含む確認者 — 実装は既に v2.21 を満たす
- FIND-606: 警備×spot/referral/security×新任未了、dispatch の対、expiresOn の '' / null、employmentDays=0 の日雇派遣、日付の前後空白・改行、'0000-00-00' ほか暦に存在しない古い日付
