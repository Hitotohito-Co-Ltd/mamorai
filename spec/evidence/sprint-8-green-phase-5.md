# Sprint 8 GREEN Phase 5（Adversary 第4回指摘対応）
日付: 2026-11-07 / ブランチ: feat/talent-foundation
RED 記録: spec/evidence/sprint-8-red-phase-5.md（TS 343件中9件が RED）。DB は 43シナリオ中 33・34 が RED

## 修正（Generator）
- renewal.ts: 契約満了日が空文字・null の項目を invalid 項目で返す（キーなしのみ対象外）。新任教育の修了日が不正な人は annual_training の invalid 項目
- eligibility.ts: 新任教育の修了日が不正なら invalid_input、日付判定は文字列以外も不正として扱う
- 0415_talent_integrity2.sql: シフトの支払単価の負値を拒否、線引き確認日が未来の案件は公開不可

## 結果
- input-core: Test Files 42 passed (42) / Tests 775 passed (775)
- tsc --noEmit: エラー0
- カバレッジ src/talent: Stmts 100 / Branch 99.48 / Funcs 100 / Lines 100
- DB 検証 (supabase/tests/run_talent_rls_check.sh): 43シナリオ all PASS（0410〜0415 を各2回適用、本番と同じ連鎖、Supabase 既定の権限付与を再現）
  - anon への revoke を消す変異でシナリオ 16・43 が FAIL することを確認（変異に耐える検証）

## 既知のリスク（仕様 KR-1〜4、Sprint 9 以降で解消）
## 未完了
- Adversary 第5回（Fresh Context）、Spec-Validator による v2.12〜v2.18 の再審査
