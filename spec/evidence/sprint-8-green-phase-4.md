# Sprint 8 GREEN Phase 4（Adversary 第3回指摘対応）
日付: 2026-11-07 / ブランチ: feat/talent-foundation
RED 記録: spec/evidence/sprint-8-red-phase-4.md（TS 292件中44件が RED）、DB は 31シナリオ中 24〜29・31 が RED

## 修正（Generator）
- eligibility.ts: 時刻・他の勤務・雇用の入社日/退社日の不正を invalid_input で拒否
- renewal.ts: 不正な期限・雇用日は一覧から消さず invalid 項目で先頭に返す。基準日が不正なら RangeError。並びはコードポイント順（サロゲートペア対応）。kind 順を明示
- 0414_talent_integrity.sql: 応募のある案件・シフトの削除禁止、金額・日数の CHECK、派遣は雇用日数必須、同意ありは同意日時必須

## 結果
- input-core: Test Files 42 passed (42) / Tests 724 passed (724)
- tsc --noEmit: エラー0
- カバレッジ src/talent: Stmts 100 / Branch 97.81 / Funcs 100 / Lines 100
- DB 検証 (supabase/tests/run_talent_rls_check.sh): 31シナリオ all PASS（0410〜0414 を各2回適用、本番と同じ連鎖、Supabase 既定の全権限付与）
  - 空振りだったシナリオ 29 は、雇用日数だけが欠けた形に直してから RED を確認した

## 既知のリスク（仕様 KR-1〜3、Sprint 9 で解消）
- 応募テーブルの直接書き込み / マイグレーションの再適用順 / 警備判定の職種依存
## 未完了
- Adversary 第4回（Fresh Context）、Spec-Validator による v2.12〜v2.16 の再審査
- OQ-20（Planner 案6点）、OQ-21（線引き確認の要否の決定主体）の RYUGEN 確認
