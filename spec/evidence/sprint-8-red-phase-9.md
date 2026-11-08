# Sprint 8 RED Phase Evidence 第9回（仕様 v2.25）

実行日時: 2026-11-08
TDD-Writer: 赤松 灯 (⑦)
再生成の記録: spec/evidence/sprint-8-test-regeneration.md（第10回）
コマンド: pnpm --filter @mamorai/input-core exec vitest run
実装（eligibility.ts / renewal.ts）は読まずに作成。緩め・skip・todo なし。

## 結果
new-feature-tests: PASS（RED なし。仕様の後追い）
  s8_talent_req026_034.test.ts: 637 件中 0 FAIL / 637 PASS（新規 24 件すべて PASS）
regression-baseline: PASS
  全体: Test Files 42 passed (42)／Tests 1069 passed (1069)。回帰 0 件。

## RED が無い理由
実装は既に listRenewals の不正な人（null・非オブジェクト・employments が配列でない・guardTraining 欠落）で TypeError を投げている。v2.25 は挙動を変えず仕様に明文化したもので、テストは仕様の後追い（v2.11 と同じ扱い）。

## 追加 24 件
- A（12）: 要素が null/undefined/'x'/42 → toThrow(TypeError) 4、RangeError でないこと 4、有効＋null の混在（先頭有効・末尾有効）2、対: 空配列は []、有効な人は従来どおり 2。
- B（12）: employments が undefined/null/文字列/オブジェクト → TypeError 4、有効な人との混在 4、guardTraining undefined 単独・混在 2、対: employments 空配列は項目なし、annualFiscalYears が配列でない人は annual_training の invalid 項目（TypeError にならない）2。
