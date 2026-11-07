# Sprint 8 GREEN Phase 3（Adversary 第2回指摘対応）
日付: 2026-11-07 / ブランチ: feat/talent-foundation
RED 記録: spec/evidence/sprint-8-red-phase-3.md（s8 231件中36件が RED）

## 修正（Generator）
- eligibility.ts: invalid_input（不正な日付・派遣の雇用日数は早期に拒否）、kind の列挙検証、線引き記録の中身の検証、拒否時は警告を返さない
- renewal.ts: 新任教育の修了日が基準日より後の人は現任教育の対象外、並びをコードポイント順に（localeCompare をやめる）
- 0413_talent_hardening2.sql: persons の参照を staff の RLS に依存しない判定関数に、派遣は職種必須、線引き確認者は空でないこと、site_id・slot_id は同じ会社のみ
- 検証ハーネスを本番と同じ連鎖（0000〜0413）に変更、Supabase 既定の全権限付与の下で実行

## 結果
- input-core: Test Files 42 passed (42) / Tests 663 passed (663)
- tsc --noEmit: エラー0
- カバレッジ src/talent: Stmts 100 / Branch 99.32 / Funcs 100 / Lines 100
- DB 検証 (supabase/tests/run_talent_rls_check.sh): 23シナリオ all PASS（0410〜0413 を各2回適用）
  - シナリオ 2・4・5・19〜22 は 0413 の前に FAIL を確認してから修正した

## 未完了
- Adversary 第3回（Fresh Context）、Spec-Validator による v2.12〜v2.14 の再審査
- OQ-20（Planner 案6点）、OQ-21（線引き確認の要否の決定主体）の RYUGEN 確認
