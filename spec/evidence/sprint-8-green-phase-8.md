# Sprint 8 GREEN Phase 8（セキュリティ監査・Adversary 第7回指摘対応）
日付: 2026-11-08 / ブランチ: feat/talent-foundation
RED 記録: spec/evidence/sprint-8-red-phase-8.md（TS 613件中26件が RED）。DB は 87シナリオ中 79〜86（権限）・85〜86（グループ一致）が RED

## 修正（Generator）
- eligibility.ts: consentJointUse・residence.workAllowed が boolean でなければ invalid_input（SEC-007）、入力件数の上限（シフト366・他の勤務1,000）で巨大入力を早期拒否（SEC-004）、utcMs を export
- renewal.ts: 日付の計算を setUTCFullYear 版にそろえ、0〜99 年がずれる不具合を修正（FIND-007）
- 0419_talent_revoke_privileges.sql: 新6テーブルの TRUNCATE・REFERENCES・TRIGGER、応募の INSERT/UPDATE/DELETE を anon/authenticated から取り消す（SEC-001 / SEC-002）
- 0420_talent_staff_person_group.sql: 雇用先の会社と人のグループの一致を検査（SEC-008）
- 0418_talent_persons_rls_perf.sql: persons の参照ポリシーを集合の1回評価に（性能報告 P-1。513ms→43ms）

## 結果
- input-core: Test Files 42 passed (42) / Tests 1045 passed (1045)
- tsc --noEmit: エラー0
- カバレッジ src/talent: Stmts 100 / Branch 99.52 / Funcs 100 / Lines 100
- DB 検証 (supabase/tests/run_talent_rls_check.sh): 87シナリオ all PASS（番号 1〜87、32 は欠番。0410〜0420 を各2回適用、本番と同じ連鎖、Supabase 既定の権限付与を再現）
  - 権限の取り消しを外す変異2件で検証が落ちることを確認

## 残る課題（Sprint 9 以降。セキュリティ報告の『公開前の必須条件』）
SEC-003（KR-5/OQ-22/19/20）、SEC-005（KR-3/OQ-21）、SEC-006（監査証跡）、SEC-009（OQ-12a/b/c、弁護士の確認）、SEC-010〜017（Medium/Low）
