# Sprint 8 RED Phase Evidence 第8回（仕様 v2.24）

実行日時: 2026-11-08
TDD-Writer: 赤松 灯 (⑦)
再生成の記録: spec/evidence/sprint-8-test-regeneration.md（第9回）
コマンド: pnpm --filter @mamorai/input-core exec vitest run
実装（eligibility.ts / renewal.ts）は読まずに作成。落ちるテストは落ちたまま（緩め・skip・todo なし）。

## 結果
new-feature-tests: FAIL
  s8_talent_req026_034.test.ts: 613 件中 26 FAIL / 587 PASS（新規 40 のうち 26 RED・14 PASS）

regression-baseline: PASS
  全体: Test Files 1 failed | 41 passed (42)／Tests 26 failed | 1019 passed (1045)
  第8回までの既存 1005 件は全て PASS。回帰 0 件。

## FAIL 一覧（26 件。実装が v2.24 に未追随）
1. consentJointUse の型（SEC-007）7 件: 'false' / 'true' / 0 / 1 / null / undefined / {} が invalid_input にならない（期待 ['invalid_input']）。
2. workAllowed の型（SEC-007）6 件: 'true' / 'false' / 0 / 1 / null / undefined が invalid_input にならない。
3. 件数の上限（SEC-004）3 件: シフト 367、busy 1,001、validateJobForPublish のシフト 367 が invalid_input にならない。
4. 上限超過の処理時間（SEC-004）4 件: 20,000 件の入力で invalid_input を返さない（上限による早期拒否が無い）。
5. listRenewals の古い年（FIND-007）6 件: 0001-01-01 / 0050-06-15 / 0099-12-31 の daysLeft が独立計算値と違う（0099-12-31 は期待 -703609、実測 -9649。1900 年代に読み替えている）、99 と 100 の連続性、在留期限 0099-12-31。0100-01-01 と 0101-01-01 は PASS。

## PASS（14 件）
boolean の true/false、residence 無し、上限ちょうど（366/1,000/validateJobForPublish 366）、夜間のシフト単位 4 件（実装は既に v2.24 を満たす）、年 100 以上の daysLeft。
