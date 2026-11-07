# Sprint 8 RED Phase Evidence 第4回（仕様 v2.15）

実行日時: 2026-11-07
TDD-Writer: 赤松 灯 (⑦)
再生成の記録: spec/evidence/sprint-8-test-regeneration.md（第5回）
コマンド: pnpm --filter @mamorai/input-core exec vitest run

## 結果
new-feature-tests: FAIL
  s8_talent_req026_034.test.ts: 292 件中 44 FAIL / 248 PASS（新規 61 のうち 44 RED・17 PASS）

regression-baseline: PASS
  全体: Test Files 1 failed | 41 passed (42)／Tests 44 failed | 680 passed (724)
  s8 を除く既存ファイルと s8 の既存 231 件は全て PASS。回帰 0 件

## FAIL 一覧（44 件。実装が v2.15 に未追随。テストは緩めていない）
A. invalid_input（29）
- シフト開始/終了時刻 '25:99','xx','9:00','24:00','' それぞれ checkEligibility と validateJobForPublish（20）: 不正でも eligible=true / reasons=[]（検証なし）
- busy の日付 garbage/2026-02-30、開始/終了時刻 zz/25:00（6）: eligible=true のまま
- employments.startOn 'garbage'（1）: invalid_input でなく not_registered が返る（理由コードの分類違い）
- employments.endOn 'garbage' / ''（2）: eligible=true のまま
B. listRenewals の invalid 項目（8）
- contractEndOn '2026/05/01'、residence.expiresOn 'garbage'、employments.startOn 不正（contract）、現任教育未了で雇用日不正（annual_training）（4）: 項目が一覧から消える（空配列）
- employments.endOn 不正（1）: invalid でなく通常の soon(daysLeft=10) として返る
- 先頭並び（1）: invalid 項目が欠落し、期限切れが先頭になる
- 基準日 'garbage' / '2026-13-45'（2）: RangeError を投げない
C. 並び（7）
- コードポイント順 3件: 実際は z,é,😀,Ａ（UTF-16 順）。期待は z,é,Ａ,😀
- 同一 personId の入力順依存 4件: kind 順にならず入力順に引きずられる（3エントリ3通り＋同一 kind 2エントリ）

## PASS した新規 17 件
対の有効入力（時刻 00:00/23:59/09:00、有効な busy、endOn 未指定/有効、有効な期限日、基準日有効）、同一 personId の3種別同日、D の7件（警備×派遣で教育不足の理由が出ない、confirmedBy=123 で TypeError なし、就労不可でも在留が一覧に出る。実装は既に準拠）。

## Planner への差し戻し候補
- employments の日付が不正なとき listRenewals が返す項目の kind: 仕様は「その項目」としか書かず、契約満了日あり→contract、現任教育が要る→annual_training とテストは読んだ。両方該当する人の件数・順序は規定が無い。
- invalid 項目の dueOn: 仕様に値の規定が無い（テストは dueOn を検証していない）。
- 複数の invalid 項目同士の並び（personId・kind 順でよいか）: 規定が無く、テストしていない。
