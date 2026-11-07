# Sprint 8 GREEN Phase 2（Adversary 指摘対応）
日付: 2026-11-07 / ブランチ: feat/talent-foundation
RED 記録: spec/evidence/sprint-8-red-phase-2.md（s8 136件中29件が RED）

## 修正（Generator）
- eligibility.ts: no_shifts、dispatch_exception_invalid（確認日の検証・age60・暦にない日付）、details（residenceDaysLeft・maxDailyHours）
- renewal.ts: 在籍中を基準日で判定（入社日≤基準日 かつ 退社日なし or ≥基準日）
- 0412_talent_hardening.sql: search_candidates の NULL 素通り・anon、jobs の他グループ職種・線引き未確認の公開、job_shifts/job_applications の越境
- t1_talent.test.ts を削除（固有ケースは s8 に移管済み。旧い戻り値の形に厳密一致する実装同時書きのテストで、Adversary FIND-012 の指摘どおり重複）

## 結果
- input-core: Test Files 42 passed (42) / Tests 568 passed (568)
- tsc --noEmit: エラー0
- カバレッジ src/talent: Stmts 100 / Branch 98.11 / Funcs 100 / Lines 100
- DB 検証 (supabase/tests/run_talent_rls_check.sh): 18シナリオ all PASS（0410〜0412 を各2回適用）
  - シナリオ 10・11・13・14 は 0412 の前に追加し、FAIL を確認してから修正した。17 は列が無く RED だった

## 未完了
- 仕様 v2.11 の曖昧さ4件のテストは後追い（実装は既にその振る舞い）
- Adversary の再評価（Fresh Context）、Spec-Validator による v2.9〜v2.11 の再審査
