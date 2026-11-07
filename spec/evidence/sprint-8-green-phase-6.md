# Sprint 8 GREEN Phase 6（Adversary 第5回指摘対応）
日付: 2026-11-07 / ブランチ: feat/talent-foundation
RED 記録: spec/evidence/sprint-8-red-phase-6.md（TS 436件中10件が RED）。DB は 68シナリオ中 65・67 が RED

## 修正（Generator）
- eligibility.ts: 線引き確認者の判定で、空白・全角空白・ゼロ幅文字（U+200B〜U+200D、U+2060、U+FEFF）を除いて空でないこと（DB の 0416 と同じ基準）
- 0416_talent_boundary_jst.sql: 線引き確認日の『今日』を日本時間にする（current_date はセッションのタイムゾーンに依存し、日本時間の朝に当日の確認日を拒否していた）、確認者のゼロ幅文字

## 結果
- input-core: Test Files 42 passed (42) / Tests 868 passed (868)
- tsc --noEmit: エラー0
- カバレッジ src/talent: Stmts 100 / Branch 99.48 / Funcs 100 / Lines 100
- DB 検証 (supabase/tests/run_talent_rls_check.sh): 68シナリオ all PASS（0410〜0416 を各2回適用、本番と同じ連鎖、Supabase 既定の権限付与を再現）
  - 代表的な変異5件(RLS 無効化、SECURITY DEFINER の削除、CHECK の緩和、人数 0 の許可、更新経路の除外)で検証が落ちることを確認
  - 私の確認用スクリプトが FAIL の文字だけを探して ERROR 終了を見逃した（RLS 無効化の変異）。変異は検出されていた

## 既知のリスク（仕様 KR-1〜5、Sprint 9 以降で解消）
## 未完了
- Spec-Validator による v2.12〜v2.19 の再審査、Evaluator の判定
- Adversary 第6回は実施するか RYUGEN が判断（第5回の指摘は D5 の検証強化と Low が中心で、実装の Critical/High はなし）
