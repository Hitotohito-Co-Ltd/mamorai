# Sprint 8 GREEN Phase 7（Adversary 第6回指摘対応）
日付: 2026-11-07 / ブランチ: feat/talent-foundation
RED 記録: spec/evidence/sprint-8-red-phase-7.md（TS 573件中32件が RED）。DB は 77シナリオ中 69・71〜73 が RED

## 修正（Generator）
- eligibility.ts: 夜間勤務をシフト時刻（22:00〜翌05:00にかかる）から導出、annualFiscalYears が配列でなければ invalid_input、日付検証を 0〜99 年でも正しく扱う（Date.UTC の 1900 年代への読み替えを避ける）
- renewal.ts: annualFiscalYears が配列でない人は annual_training の invalid 項目で返し、一覧全体を失敗させない
- 0417_talent_boundary_status_space.sql: 線引き未確認は published だけでなく filled でも保存不可（draft は可）、確認者の空白を Unicode 全体にそろえる

## 結果
- input-core: Test Files 42 passed (42) / Tests 1005 passed (1005)
- tsc --noEmit: エラー0
- カバレッジ src/talent: Stmts 100 / Branch 99.51 / Funcs 100 / Lines 100
- DB 検証 (supabase/tests/run_talent_rls_check.sh): 77シナリオ all PASS（番号 1〜78、32 は欠番。0410〜0417 を各2回適用、本番と同じ連鎖、Supabase 既定の権限付与を再現）

## 既知の限界（Adversary 第6回の FIND-605）
- 『今日は日本時間』の検証は実行時刻に依存する（JST と UTC の日付が異なる 15:00〜24:00 UTC の時間帯だけ、JST と UTC の実装を区別できる）。now() を固定できないための限界

## 既知のリスク（仕様 KR-1〜5、Sprint 9 以降で解消）
## 未完了
- Spec-Validator による v2.20〜v2.21 の再審査、Evaluator の判定
- Adversary 第7回は実施しない案（RYUGEN の判断待ち）。第6回までの指摘は Critical 0、High は検証の欠落のみ
