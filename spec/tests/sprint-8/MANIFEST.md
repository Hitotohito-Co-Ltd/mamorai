# Sprint 8 テストカバレッジ MANIFEST

TDD-Writer: 赤松 灯 (⑦)  
作成日: 2026-11-07  
仕様バージョン: behavioral-spec.md 追補 v2.10（インターフェース契約・境界の確定を含む）
再生成: 2026-11-07 第1回（v2.6）と第2回（v2.10。Adversary FIND-004/005/006/007/009）。spec/evidence/sprint-8-test-regeneration.md 参照
結果（第2回の RED 時点）: s8 は 136 件中 107 PASS / 29 RED。RED は全て第2回で追加した新規テスト（実装が v2.10 に未追随）。第1回の RED 2件（S8-026-03, S8-033-03）は実装修正により PASS 済み

---

## REQ → テスト ID 対応表

### REQ-026: 応募可否の判定

| テスト ID | ファイル | describe / it | 観点 | 状態 |
|---|---|---|---|---|
| S8-026-01 | s8_talent_req026_034.test.ts | [REQ-026] / eligible_全条件を満たすとき_eligible=true_reasons空_warnings空 | HAPPY_PATH | PASS |
| S8-026-02 | s8_talent_req026_034.test.ts | [REQ-026] / eligible_複数シフト全日在籍中_eligible=true | HAPPY_PATH 複数シフト | PASS |
| S8-026-03 | s8_talent_req026_034.test.ts | [REQ-026] / enrollment_最終シフト日より前に退社する人は不可 | EDGE_CASE 在籍チェック ★仕様確定 | PASS（実装修正済み） |
| S8-026-04 | s8_talent_req026_034.test.ts | [REQ-026] / enrollment_入社前のシフト日は不可 | EDGE_CASE 入社前 | PASS |
| S8-026-05 | s8_talent_req026_034.test.ts | [REQ-026] / enrollment_退社日当日のシフトは可 | EDGE_CASE 境界（退社日当日） | PASS |
| S8-026-06 | s8_talent_req026_034.test.ts | [REQ-026] / multiReason_年齢制限と在留無効が同時にある場合_両方の理由コードを返す | 複数理由同時 | PASS |
| S8-026-07 | s8_talent_req026_034.test.ts | [REQ-026] / determinism_同一入力で2回呼び出すと同一の結果を返す | 決定論 | PASS |
| S8-026-P1 | s8_talent_req026_034.test.ts | [REQ-026] 純粋性 / talentPurity_ソースが1件以上ある | 純粋性 | PASS |
| S8-026-P2 | s8_talent_req026_034.test.ts | [REQ-026] 純粋性 / talentPurity_非決定API・外部依存を参照しない | 純粋性 | PASS |

### REQ-027: 警備業務は派遣にできない

| テスト ID | describe / it | 観点 | 状態 |
|---|---|---|---|
| S8-027-01 | securityDispatch_警備×派遣の案件は公開前チェックで拒否される | `validateJobForPublish` が `['security_dispatch_forbidden']` | PASS |
| S8-027-02 | securityDispatch_警備×直接雇用は登録可 | `[]` | PASS |
| S8-027-03 | securityDispatch_非警備×派遣は登録可 | `[]` | PASS |
| S8-027-04 | securityDispatch_eligibility_警備×派遣の案件への応募も拒否される | checkEligibility 経由 | PASS |

### REQ-028: 警備の枠への応募資格（教育）

| テスト ID | ファイル | describe / it | 観点 | 状態 |
|---|---|---|---|---|
| S8-028-01 | s8_talent_req026_034.test.ts | [REQ-028] / basicTraining_新任教育未修了の人は警備案件に応募不可 | ERROR_HANDLING | PASS |
| S8-028-02 | s8_talent_req026_034.test.ts | [REQ-028] / basicTraining_修了日が未来の場合は不可 | EDGE_CASE | PASS |
| S8-028-03 | s8_talent_req026_034.test.ts | [REQ-028] / annualTraining_当年度の現任教育未了なら不可 | ERROR_HANDLING | PASS |
| S8-028-04 | s8_talent_req026_034.test.ts | [REQ-028] / annualTraining_今年度に新任教育を修了した人は現任教育不要 | EDGE_CASE 新任同年度 | PASS |
| S8-028-05 | s8_talent_req026_034.test.ts | [REQ-028] / annualTraining_年度境界_3月31日はFY2025_FY2025の現任があれば可 | EDGE_CASE 年度境界 3/31 | PASS |
| S8-028-06 | s8_talent_req026_034.test.ts | [REQ-028] / annualTraining_年度境界_4月1日はFY2026_FY2025のみでは不可 | EDGE_CASE 年度境界 4/1 | PASS |
| S8-028-07 | s8_talent_req026_034.test.ts | [REQ-028] / annualTraining_年度をまたぐ複数日シフト_FY2025のみでは4月1日分で不可 | EDGE_CASE 年度またぎ | PASS |

### REQ-029: 日雇派遣（30日以内）の例外

| テスト ID | ファイル | describe / it | 観点 | 状態 |
|---|---|---|---|---|
| S8-029-01 | s8_talent_req026_034.test.ts | [REQ-029] / dailyDispatch_30日の派遣で例外なし_不可 | ERROR_HANDLING | PASS |
| S8-029-02 | s8_talent_req026_034.test.ts | [REQ-029] / dailyDispatch_30日の派遣で例外あり（60歳以上）_可 | HAPPY_PATH 例外あり（v2.10: 本人を66歳に修正） | PASS |
| S8-029-03 | s8_talent_req026_034.test.ts | [REQ-029] / dailyDispatch_31日以上の派遣は例外不要 | EDGE_CASE 31日 | PASS |
| S8-029-04 | s8_talent_req026_034.test.ts | [REQ-029] / dailyDispatch_30日ちょうどは例外が必要（31日は不要の境界） | EDGE_CASE 境界 30/31 | PASS |

### REQ-030: 年齢制限

| テスト ID | ファイル | describe / it | 観点 | 状態 |
|---|---|---|---|---|
| S8-030-01 | s8_talent_req026_034.test.ts | [REQ-030] / age_18歳誕生日前日は17歳_警備案件は不可 | EDGE_CASE 誕生日前日 | PASS |
| S8-030-02 | s8_talent_req026_034.test.ts | [REQ-030] / age_18歳誕生日当日から18歳として扱い_警備案件は可 | EDGE_CASE 誕生日当日 | PASS |
| S8-030-03 | s8_talent_req026_034.test.ts | [REQ-030] / age_夜間勤務を含む案件でも18歳未満は不可 | EDGE_CASE 夜間 | PASS |
| S8-030-04 | s8_talent_req026_034.test.ts | [REQ-030] / age_警備でも夜間でもない案件は年齢で拒否しない | 対象外確認 | PASS |

### REQ-031: 時間の重なりと労働時間の通算

| テスト ID | ファイル | describe / it | 観点 | 状態 |
|---|---|---|---|---|
| S8-031-01 | s8_talent_req026_034.test.ts | [REQ-031] / overlap_夜勤日またぎ_22:00〜06:00と翌日05:00〜09:00は重なる | EDGE_CASE 夜勤日またぎ | PASS |
| S8-031-02 | s8_talent_req026_034.test.ts | [REQ-031] / overlap_夜勤日またぎ_翌日06:00開始は重ならない（境界） | EDGE_CASE 境界 06:00 | PASS |
| S8-031-03 | s8_talent_req026_034.test.ts | [REQ-031] / dailyHours_合計8時間ちょうどは警告なし | EDGE_CASE 8h境界 | PASS |
| S8-031-04 | s8_talent_req026_034.test.ts | [REQ-031] / dailyHours_8時間1分超で警告付き可（eligible=true） | EDGE_CASE 8h1m | PASS |
| S8-031-05 | s8_talent_req026_034.test.ts | [REQ-031] / dailyHours_他社の勤務も通算に含める | 他社通算 | PASS |

### REQ-032: 在留カードの就労可否と期限（基準はシフト日）

| テスト ID | describe / it | 観点 | 状態 |
|---|---|---|---|
| S8-032-01 | residence_就労不可の在留資格なら不可 | ERROR_HANDLING | PASS |
| S8-032-02 | residence_在留期限翌日以降のシフトは不可 | 期限翌日 | PASS |
| S8-032-03 | residence_在留期限当日のシフトは可 | 期限当日 | PASS |
| S8-032-04 | residence_シフト日から在留期限まで60日ちょうどは警告付きで可 | 境界 60日=警告 | PASS |
| S8-032-05 | residence_シフト日から在留期限まで61日は警告なしで可 | 境界 61日=警告なし | PASS |
| S8-032-06 | residence_シフト日が期限当日（日数0）は警告付きで可 | 境界 0日=警告 | PASS |
| S8-032-07 | residence_シフト日が期限の翌日（日数-1）は拒否され警告は出ない | 境界 -1日=拒否 | PASS |
| S8-032-08 | residence_在留情報がない人（日本国籍など）には本要件を適用しない | 対象外 | PASS |

### REQ-033: 更新手続きの期限一覧（項目 = personId, kind, dueOn, daysLeft, urgency）

| テスト ID | describe / it | 観点 | 状態 |
|---|---|---|---|
| S8-033-01 | list_空の場合_空配列を返す | 3状態: 空 | PASS |
| S8-033-02 | list_単数_1件の更新手続きを返す | 3状態: 単数（全フィールド） | PASS |
| S8-033-03 | allRetired_全雇用が退社済みの人は現任教育の更新対象外（仕様確定） | 除外 | PASS（実装修正済み） |
| S8-033-04 | allRetired_対_在籍中の雇用が1件でもあれば現任教育は更新対象 | 対（含まれる） | PASS |
| S8-033-05 | noBasic_新任教育未修了の人は現任教育の更新対象外 | 除外 | PASS |
| S8-033-06 | noBasic_対_新任修了済みで現任未了なら現任教育は更新対象 | 対（含まれる） | PASS |
| S8-033-07 | newlyBasic_今年度に新任修了した人は現任教育の更新対象外 | 除外 | PASS |
| S8-033-08 | newlyBasic_対_年度末前日(2026-03-31)に新任修了した人はFY2026では現任教育が更新対象 | 年度境界の対 | PASS |
| S8-033-09 | contractEnd_退社済みの雇用の契約満了は対象外 | 除外 | PASS |
| S8-033-10 | contractEnd_対_在籍中の雇用の契約満了は30日以内なら含む | 対（含まれる） | PASS |
| S8-033-11 | sort_期限切れが先頭_次いで期限が近い順 | personId の並び | PASS |
| S8-033-12 | filter_期限まで31日の契約満了は一覧に含まない | 境界 31日 | PASS |
| S8-033-13 | filter_対_期限まで30日ちょうどの契約満了は一覧に含む | 境界 30日 | PASS |

### REQ-034: 運営枠と警備枠の線引き確認

| テスト ID | describe / it | 観点 | 状態 |
|---|---|---|---|
| S8-034-01 | boundaryCheck_確認が必要で記録がない案件は公開拒否 | `['boundary_not_confirmed']` | PASS |
| S8-034-02 | boundaryCheck_確認が必要で記録がある案件は公開可 | `[]` | PASS |
| S8-034-03 | boundaryCheck_確認不要な案件は記録なしでも公開可 | `[]` | PASS |
| S8-034-04 | boundaryCheck_警備×派遣かつ線引き記録なしは両方の理由コードで拒否される | 複合 | PASS |
| S8-034-05 | boundaryCheck_eligibility_記録なしの案件への応募も拒否される | checkEligibility 経由 | PASS |

### REQ-035: スタッフ台帳と共同利用の同意（v2.6: 同意なしはどの案件にも応募不可）

| テスト ID | describe / it | 観点 | 状態 |
|---|---|---|---|
| S8-035-01 | noConsent_同意なしの人は他社の案件に応募できない | no_consent | PASS |
| S8-035-02 | noConsent_同意なしは自社の案件でも no_consent で不可 | `reasons` が `['no_consent']` | PASS |
| S8-035-03 | noConsent_対_同意ありなら同じ自社の案件は応募可 | 対 | PASS |
| S8-035-DB1〜DB9 | talent_rls_check.sql | シナリオ 1〜9（他社管理者は他社 person を読めない／自社は読める／運営は全件／自社は同意なしも見える／search_candidates は同意済みだけ・同グループだけ・権限外を拒否 ほか） | AUTH_GATE / DATA_PERSISTENCE | 9シナリオ all PASS（sprint-8-green-phase.log。search_candidates は 0411 で実装済み） |

### NFR-05: 1,000 人分 listRenewals の性能

| テスト ID | ファイル | describe / it | 観点 | 状態 |
|---|---|---|---|---|
| S8-N05-01 | s8_talent_req026_034.test.ts | [NFR-05] / performance_1000人分_結果が期待件数ちょうど（契約満了250＋現任教育250＝500件）で並び順も正しい | 結果検証: 件数 500 と (personId, kind, daysLeft) の並びを厳密に比較（旧: length>=500） | PASS |
| S8-N05-02 | s8_talent_req026_034.test.ts | [NFR-05] / performance_1000人分の_listRenewals_が_1秒以内に完了する | 性能: < 1000ms | PASS |

---

## 第2回（v2.10）で追加したテスト（describe 単位。it 名は test ファイル参照）

| 区分 | describe | 件数 | 観点 | RED |
|---|---|---|---|---|
| FIND-004 | [REQ-026] 空のシフト（no_shifts） | 7 | checkEligibility（在籍済み/未在籍）、validateJobForPublish、listApplicableJobs、対（1件あれば可） | 5 |
| FIND-005 | [REQ-033] 在籍中の判定（基準日） | 11 | 退社予定日が後/当日/前、入社日が未来/当日、複数雇用、現任教育の4境界＋対 | 5 |
| FIND-006 | [REQ-032] details.residenceDaysLeft | 6 | 最小日数（20と50、順序入替、60日超混在、当日0）、61日・在留なしはキー無し | 6 |
| FIND-006 | [REQ-031] details.maxDailyHours | 6 | 3h+6h=9、複数日の最大(9/10)、別日は通算しない、8hちょうどはキー無し、片方の警告時に他方のキー無し | 6 |
| FIND-007 | [REQ-029] 日雇派遣の例外の検証 | 13 | verifiedOn 空/不正形式×4/シフト日より後、age60 59歳/60歳当日、day_student の可、例外なし、31日 | 7 |
| FIND-009 | [REQ-033] 在留期限の更新手続きと並び順 | 10 | residence の expired(-1,-37)/0/30/31日、契約満了 -1、同日 personId 昇順、種別混在の全体順 | 0 |
| FIND-009 | [REQ-026] listApplicableJobs | 6 | 空/全可（入力順）/全不可/一部除外/busy/同意なし | 0 |
| FIND-009 | NFR-05 | 1（置換） | 500 件ちょうどと並び順 | 0 |
| t1 移行 | ageOn / fiscalYearOf / shiftsOverlap / スポット登録 / 在留24日 | 13 | 旧 t1_talent.test.ts 固有ケース | 0 |

合計 s8: 136 件（107 PASS / 29 RED）。

### 第2回 RED 29 件（全て実装が v2.10 に未追随。テストは緩めていない）
- no_shifts 5 件（checkEligibility 2、validateJobForPublish 2、listApplicableJobs 1）
- 在籍中の判定 5 件（退社予定日が基準日より後／退社日が基準日当日で契約満了が出ない、入社日が未来で契約満了・現任教育が出る、現任教育で退社日当日が対象外）
- details 12 件（`details` 自体が未実装）
- dispatch_exception_invalid 7 件（空文字・不正形式×4・シフト日より後・age60 の59歳）

---

## 未カバーの REQ と理由

| REQ | カバー状態 | 理由 |
|---|---|---|
| REQ-036〜040 | 本スプリント外 | OQ-15 は解決済み（凍結解除）。Sprint 9 のテスト生成で扱う |
| REQ-038 | 未作成 | Sprint 9（未着手）|
| REQ-035 画面 | 未作成 | OQ-12a/b/c が未決のため着手しない（DB 側のみ Sprint 8 で検証済み） |

### Planner への差し戻し（仕様に書かれていないためテストにしていない）
- 夜勤で start と end が同時刻（例 22:00〜22:00）を 24 時間勤務とみなすか。`dailyHours` と `shiftsOverlap` の期待が決められない。
- 同じ personId で同日・同 daysLeft の異種項目（契約満了と在留期限が同日）の並び。「入力順」の入力が人の入力順か、種別の順かが不明。
- `age60` の「シフト日に満60歳以上」を複数シフト日でどう判定するか（全シフト日か、最初の日か）。
- 暦として存在しない日付（`2026-13-45`）を `verifiedOn` の形式不正とみなすか。

---

## 作成ファイル

| ファイル | 種別 |
|---|---|
| `packages/input-core/src/__tests__/s8_talent_req026_034.test.ts` | Vitest ユニットテスト（136 テスト） |
| `supabase/tests/talent_rls_check.sql` | DB RLS/関数 検証 SQL（9 シナリオ） |
| `supabase/tests/run_talent_rls_check.sh` | RLS 検証実行スクリプト |
| `spec/evidence/sprint-8-red-phase.log` | 初回〜第1回 RED フェーズ実行エビデンス |
| `spec/evidence/sprint-8-red-phase-2.md` | 第2回 RED フェーズ実行エビデンス |
| `spec/evidence/sprint-8-test-regeneration.md` | 再生成の記録 |
| `spec/tests/sprint-8/MANIFEST.md` | 本ファイル |
