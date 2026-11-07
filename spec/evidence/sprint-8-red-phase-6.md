# Sprint 8 RED Phase Evidence 第6回（仕様 v2.19）

実行日時: 2026-11-07
TDD-Writer: 赤松 灯 (⑦)
再生成の記録: spec/evidence/sprint-8-test-regeneration.md（第7回）
コマンド: pnpm --filter @mamorai/input-core exec vitest run

## 結果
new-feature-tests: FAIL
  s8_talent_req026_034.test.ts: 436 件中 10 FAIL / 426 PASS（新規 93 のうち 10 RED・83 PASS）

regression-baseline: PASS
  全体: Test Files 1 failed | 41 passed (42)／Tests 10 failed | 858 passed (868)
  既存 775 件は全て PASS。回帰 0 件。

## FAIL 一覧（10 件。REQ-034 確認者のゼロ幅文字。実装が v2.19 に未追随。テストは緩めていない）
公開前チェック（期待 ['boundary_not_confirmed']、実際 []）: U+200B / U+200C / U+200D / U+2060 / 5種の連続 / 同一文字の連続 / ゼロ幅文字と空白の混在（7）
応募（期待 eligible=false、実際 true）: U+200B / 5種の連続 / ゼロ幅文字と空白の混在（3）

## PASS（83 件。実装が既に満たしている）
年齢・時間の重なり・警備×派遣・線引き確認の形・basicDoneOn 空文字・今年度済みの現任教育・instant・employmentDays 派遣のみ・soonDays・不正な雇用・同日修了、および対（有効入力）。U+FEFF 単独は JS の trim が除去するため PASS。変異の生き残りへの固定として残す。
