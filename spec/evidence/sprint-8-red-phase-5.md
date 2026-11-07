# Sprint 8 RED Phase Evidence 第5回（仕様 v2.18）

実行日時: 2026-11-07
TDD-Writer: 赤松 灯 (⑦)
再生成の記録: spec/evidence/sprint-8-test-regeneration.md（第6回）
コマンド: pnpm --filter @mamorai/input-core exec vitest run

## 結果
new-feature-tests: FAIL
  s8_talent_req026_034.test.ts: 343 件中 9 FAIL / 334 PASS（新規 51 のうち 9 RED・42 PASS）

regression-baseline: PASS
  全体: Test Files 1 failed | 41 passed (42)／Tests 9 failed | 766 passed (775)
  既存 724 件は全て PASS。回帰 0 件。純粋性テスト（禁止パターン追加後）も PASS（talent 配下に違反なし）

## FAIL 一覧（9 件。実装が v2.18 に未追随。テストは緩めていない）
A. FIND-401（3）
- contractEndOn が空文字: 項目が消える（contract / invalid / dueOn '' で返るべき）
- contractEndOn が null: 項目が消える（dueOn は null）
- 空文字の invalid が期限切れ・間近より先頭に並ぶ: 項目が消えるため不成立
B. FIND-402（6）
- basicDoneOn 'garbage' / '2026-04-99' × 警備案件・非警備案件の checkEligibility（4）: invalid_input が出ない
- 同 × listRenewals（2）: annual_training の invalid 項目（dueOn は 年度+1 の 03-31）が返らない

## PASS（実装が既に満たしているため RED にならなかった 42 件）
時刻・日付の形式の厳格化（C①②）、日雇派遣は派遣のみ（C③）、退社日空文字の invalid 項目（C④）、personId 接頭辞の並び（C⑤）、residence.expiresOn 空文字、undefined の対、有効値の対。変異の生き残りへの固定として残す。
