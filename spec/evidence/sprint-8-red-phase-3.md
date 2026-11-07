# Sprint 8 RED Phase Evidence 第3回（仕様 v2.13）

実行日時: 2026-11-07
TDD-Writer: 赤松 灯 (⑦)
再生成の記録: spec/evidence/sprint-8-test-regeneration.md（第4回）
コマンド: pnpm --filter @mamorai/input-core exec vitest run

## 結果
new-feature-tests: FAIL
  s8_talent_req026_034.test.ts: 231 件中 36 FAIL / 195 PASS（新規 67 のうち 36 RED・31 PASS）

regression-baseline: PASS
  全体: Test Files 1 failed | 41 passed (42)／Tests 36 failed | 627 passed (663)
  s8 を除く既存ファイルと s8 の既存 164 件は全て PASS。回帰 0 件

## FAIL 一覧（36 件。実装が v2.13 に未追随。テストは緩めていない）
A. invalid_input（18）
- シフト日 'abc' / '2026-02-30' / '2026-4-1' それぞれ checkEligibility と validateJobForPublish（計6）: invalid_input が返らない
- 複数シフトの1日が不正（1）
- birthDate 'garbage' / '2008-02-30'（2）: 警備案件で18歳未満判定をすり抜ける／invalid_input が出ない
- residence.expiresOn 'garbage'（1）
- employmentDays が undefined / NaN / -1 / 1.5 それぞれ checkEligibility と公開前チェック（8）
B. kind が 'bogus'（1）: dispatch_exception_invalid が出ない
C. 在留（2）: 期限当日と期限超過が混在する案件で residence_expiring と residenceDaysLeft が返る（順序違いの2件）
D. 線引き記録（10）: 確認者が空文字・空白・全角空白／確認日が不正・暦にない・空文字を「記録あり」と扱う（公開6、応募4）
E. 新任の未来日（2）: basicDoneOn が基準日より後の人に annual_training が出る
F. コードポイント順（3）: 現状は a,A,b,B,z（ロケール順）。é は z の後ろに来るべきが前に来る

## PASS した新規 31 件
対の有効入力（有効な日付・birthDate・expiresOn・employmentDays 0/30/31・有効4区分・有効な線引き記録・期限超過が無い日の警告・基準日前に新任修了の人）、G 日またぎの通算 4 件、H ミューテーション境界 11 件（実装は既に準拠）。

## Planner への差し戻し候補
- REQ-034 の確認日が暦にない場合: 契約では「記録なし」扱い（boundary_not_confirmed）と、`invalid_input`（確認日が暦の日付でない）の両方に読める。本テストは呼び出し元の指示どおり boundary_not_confirmed のみ（公開は完全一致 `['boundary_not_confirmed']`）を期待している。
