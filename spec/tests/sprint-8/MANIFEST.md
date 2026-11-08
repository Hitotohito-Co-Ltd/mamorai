# Sprint 8 テストカバレッジ MANIFEST

TDD-Writer: 赤松 灯 (⑦)  
作成日: 2026-11-07  
仕様バージョン: behavioral-spec.md 追補 v2.24（インターフェース契約・境界の確定を含む。REQ-035 は 035a=Sprint 8 / 035b=Sprint 9 に分割）
再生成: 2026-11-07 第1回（v2.6）、第2回（v2.10。FIND-004/005/006/007/009）、第3回（v2.11）、第4回（v2.13。FIND-104〜111）、第5回（v2.15。Adversary 第3回 FIND-302/303/304/305/309）、第6回（v2.18。Adversary 第4回 FIND-401/402/403/405）、第7回（v2.19。Adversary 第5回 FIND-505/507/508）、第8回（v2.21。Adversary 第6回 FIND-602/603/606/608/610）、第9回（v2.24。セキュリティ監査 SEC-004/007、Adversary 第7回 FIND-004/007）。spec/evidence/sprint-8-test-regeneration.md 参照
結果（最新の GREEN 実測、2026-11-07。`pnpm --filter @mamorai/input-core exec vitest run`）: 第8回までの GREEN は input-core 1005 件 全 PASS（s8 573 件）。第9回追加後の RED 実測（2026-11-08）: input-core 全体 1045 件中 26 FAIL・1019 PASS（s8 は 613 件。新規 40 のうち 26 RED・14 PASS）。第9回の GREEN は未実測。tsc エラー 0。`src/talent` のカバレッジは Stmts 100 / Branch 99.51 / Funcs 100 / Lines 100。DB 検証 `supabase/tests/run_talent_rls_check.sh` は 77 シナリオ all PASS（番号 1〜78、32 は欠番）。各回の RED 時点の件数は spec/evidence/sprint-8-red-phase*.md、GREEN は sprint-8-green-phase*.md を参照

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

### REQ-035a（Sprint 8）: スタッフ台帳と共同利用の同意（v2.6: 同意なしはどの案件にも応募不可）

035a = 人と雇用の台帳、会社ごとの参照制限、同意フラグ、`search_candidates`、同意の整合 CHECK。035b（登録 RPC・同意送信 RPC・同意の画面。Sprint 9）は未着手でテスト未作成。以下は 035a のみ。

| テスト ID | describe / it | 観点 | 状態 |
|---|---|---|---|
| S8-035-01 | noConsent_同意なしの人は他社の案件に応募できない | no_consent | PASS |
| S8-035-02 | noConsent_同意なしは自社の案件でも no_consent で不可 | `reasons` が `['no_consent']` | PASS |
| S8-035-03 | noConsent_対_同意ありなら同じ自社の案件は応募可 | 対 | PASS |
| S8-035-DB | supabase/tests/talent_rls_check.sql の77シナリオ（本番と同じ連鎖 0000〜0413 で実行。Supabase 既定の全権限付与下で RLS だけが砦） | AUTH_GATE / DATA_PERSISTENCE | 77シナリオ（番号 1〜78、32 は欠番。実行結果は sprint-8-green-phase 系の記録を参照） |

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

---

## 作成ファイル

| ファイル | 種別 |
|---|---|
| `packages/input-core/src/__tests__/s8_talent_req026_034.test.ts` | Vitest ユニットテスト（231 テスト） |
| `supabase/tests/talent_rls_check.sql` | DB RLS/関数 検証 SQL（77 シナリオ。番号 32 は欠番） |
| `supabase/tests/run_talent_rls_check.sh` | RLS 検証実行スクリプト |
| `spec/evidence/sprint-8-red-phase.log` | 初回〜第1回 RED フェーズ実行エビデンス |
| `spec/evidence/sprint-8-red-phase-2.md` | 第2回 RED フェーズ実行エビデンス |
| `spec/evidence/sprint-8-test-regeneration.md` | 再生成の記録 |
| `spec/tests/sprint-8/MANIFEST.md` | 本ファイル |


---

## 追加 第3回（仕様 v2.11: 曖昧さ4件の確定。仕様の後追い）

実装は既にこの振る舞いに準拠していたため、追加した28件は全て初回から PASS（RED なし）。s8 は 164 件、input-core 全体は 596 件 PASS。

| テスト ID | REQ | describe（s8_talent_req026_034.test.ts） | 件数 | 観点 | 状態 |
|---|---|---|---|---|---|
| S8-031-24h | REQ-031 | 開始と終了が同時刻のシフトは24時間勤務 | 8 | 翌日の日中と重なる / 終了ちょうど(22:00)は重ならない / 21:59 は重なる / 開始前は重ならない / 応募側が24時間 / 24時間は警告 `daily_hours_over_8` / 8時間勤務は警告なし | PASS |
| S8-033-kind | REQ-033 | 同順位の種別の並び | 4 | 同人・同日の3種が contract→annual_training→residence / personId が先 / 期限切れ同日 / daysLeft が種別より優先 | PASS |
| S8-029-age60 | REQ-029 | age60 は全シフト日で満60歳以上 | 6 | 59歳と60歳の日が混在→不可（順序を逆にしても）/ 両日60歳以上→可 / 単日59歳→不可 / 確認日は全シフト日以前 | PASS |
| S8-029-cal | REQ-029 | verifiedOn の暦検証 | 10 | 不可6（2026-13-45, 2026-02-30, 04-31, 平年02-29, 00月, 00日）/ 可4（02-28, うるう年02-29, 04-30, 01-01） | PASS |

---

## 追加 第4回（仕様 v2.13。Adversary 第2回 FIND-104/105/106/107/108/111）

追加 67 件（s8 は 231 件）。うち 36 件が RED（実装が v2.13 に未追随）、31 件は対（有効入力）で PASS。

| 区分 | REQ | describe（s8_talent_req026_034.test.ts） | 件数 | RED |
|---|---|---|---|---|
| A | REQ-026/037 | 不正な入力は invalid_input で拒否（シフト日・birthDate・residence.expiresOn・employmentDays、対の有効入力） | 26 | 18 |
| B | REQ-029 | 例外区分 kind の検証（bogus、有効4区分） | 5 | 1 |
| C | REQ-032 | 在留の拒否と警告は同時に返さない | 4 | 2 |
| D | REQ-034 | 線引き記録は確認者が非空白・確認日が暦の日付のときだけ有効 | 11 | 10 |
| E | REQ-033 | 基準日より後に新任を修了する人は現任教育の対象外 | 3 | 2 |
| F | REQ-033 | 同日・同 daysLeft の並びはコードポイント順 | 3 | 3 |
| G | REQ-031 | 日またぎ勤務は全時間を始業日に計上 | 4 | 0 |
| H | REQ-026/028/031/032 | 新任の修了日境界、複数雇用、入社日境界、非警備、警告値の最大/最小 | 11 | 0 |

---

## 追加 第5回（仕様 v2.15。Adversary 第3回 FIND-302/303/304/305/309）

追加 61 件（s8 は 292 件）。うち 44 件が RED（実装が v2.15 に未追随）、17 件は対（有効入力）・ミューテーション対応で PASS。RenewalItem の型は未更新のため、テスト内でキャストしている。

| 区分 | REQ | describe（s8_talent_req026_034.test.ts） | 件数 | RED |
|---|---|---|---|---|
| A1 | REQ-026/037 | 時刻の不正は invalid_input（シフトの開始/終了 '25:99','xx','9:00','24:00','' ×checkEligibility/validateJobForPublish、対 '00:00','23:59','09:00'） | 23 | 20 |
| A2 | REQ-026/037 | 他の勤務(busy)の不正（日付 garbage/2026-02-30、時刻 zz/25:00、対） | 7 | 6 |
| A3 | REQ-026/037 | 雇用の日付の不正（startOn garbage、endOn garbage/空文字、対 undefined/有効） | 5 | 3 |
| B | REQ-033 | 期限日が不正な項目は urgency=invalid, daysLeft=null で先頭に返す／基準日不正は RangeError | 10 | 8 |
| C1 | REQ-033 | personId はコードポイント順（z,é,Ａ,😀。入力順3通り） | 3 | 3 |
| C2 | REQ-033 | 同一 personId・同日・同 daysLeft の並びは入力順に依らず kind 順 | 6 | 4 |
| D1 | REQ-028 | 警備×派遣では教育不足の理由を出さない（＋対） | 2 | 0 |
| D2 | REQ-034 | confirmedBy が数値でも TypeError を出さず boundary_not_confirmed | 3 | 0 |
| D3 | REQ-033 | 就労不可でも在留期限は一覧に出る（＋対） | 2 | 0 |


---

## 追加 第6回（仕様 v2.18。Adversary 第4回 FIND-401/402/403/405）

追加 51 件（s8 は 343 件）。うち 9 件が RED（RED 時点の記録。実装が v2.18 に未追随）、42 件は対（有効入力）・ミューテーション対応で PASS。純粋性テスト t1_talent_purity.test.ts は禁止パターンを追加（performance.now / crypto.randomUUID / Intl. / toLocale 系 / 引数なし Date()）、talent 配下は違反なしで PASS のまま。RED の詳細は spec/evidence/sprint-8-red-phase-5.md。

| REQ | 内容 | 件数 | RED |
|---|---|---|---|
| REQ-033 | FIND-401: contractEndOn が空文字/null は contract の invalid 項目（dueOn は入力値）、undefined は項目なし、residence.expiresOn 空文字 | 7 | 3 |
| REQ-026/028/033 | FIND-402: basicDoneOn 不正は invalid_input（警備・非警備）、listRenewals は annual_training の invalid 項目（dueOn=年度末）、undefined は invalid でない | 8 | 6 |
| REQ-026/037 | FIND-403: 時刻（30:00 / 10:60 / 09:00:00 / x09:00 / 09:00x / 先頭空白 / 数値 900 と 00:00・23:59・19:59・20:00 の有効境界）、日付（T 付き / 末尾・先頭文字 / 先頭空白） | 22 | 0 |
| REQ-029 | FIND-403: 日雇派遣判定は派遣のときだけ（spot / referral / security で 30 日以下） | 7 | 0 |
| REQ-033 | FIND-403: 退社日が空文字の雇用の invalid 項目（contract / annual_training の dueOn）、personId 接頭辞の並び（ab/abc、''/a） | 7 | 0 |


---

## 追加 第7回（仕様 v2.19。Adversary 第5回 FIND-505/507/508）

追加 93 件（s8 は 436 件）。RED 時点の記録: 10 件が RED（確認者のゼロ幅文字のみ）、83 件は対（有効入力）・ミューテーション対応で PASS。RED の詳細は spec/evidence/sprint-8-red-phase-6.md。

| REQ | 内容 | 件数 | RED |
|---|---|---|---|
| REQ-030 | 年齢は各シフト日で判定（警備・夜間 × 17歳の日と18歳の日の順序違い、対: 全日18歳・非対象案件） | 9 | 0 |
| REQ-031 | 時間の重なりは全シフト（最初／2つ目／最後だけ重なる、対: 別日・接する時刻） | 5 | 0 |
| REQ-027/028 | 警備×派遣は employmentDays 10/30/31/90 で拒否（応募・公開前）、対: 非警備×派遣 | 11 | 0 |
| REQ-034 | 線引き確認は form 4種すべてで拒否、対: 記録あり／不要 | 12 | 0 |
| REQ-026/033 | basicDoneOn 空文字は invalid_input／annual_training の invalid 項目、対: undefined | 5 | 0 |
| REQ-033 | basicDoneOn 不正でも今年度の現任教育済みなら invalid 項目なし、対: 未達 | 5 | 0 |
| REQ-026 | listApplicableJobs は mode=instant でも可否に影響しない | 1 | 0 |
| REQ-026 | employmentDays の検証は派遣のみ（spot/security で undefined/NaN/-1 は invalid_input でない、対: 派遣） | 9 | 0 |
| REQ-033 | soonDays=7 と既定30 の境界を契約・在留・現任教育で固定 | 12 | 0 |
| REQ-033 | 不正な雇用: 契約は通常項目、現任教育は invalid、契約満了日ありのみ contract invalid | 7 | 0 |
| REQ-033 | 基準日と新任修了日が同日／翌日／前年度 | 4 | 0 |
| REQ-034 | 確認者のゼロ幅文字（U+200B/200C/200D/2060/FEFF、連続、空白混在）→ 記録なし、対: 可視文字あり | 14 | 10 |

注: 「前年度に修了」かつ「基準日と同日」は同時に成立しない（同日なら同じ年度）ため、前年度の対は基準日の前年度末日（2026-03-31）修了で表現した。U+FEFF 単独は JS の trim が除去するため実装が既に満たし PASS。


---

## 追加 第8回（仕様 v2.21。Adversary 第6回 FIND-602/603/606/608/610）

追加 137 件（s8 は 573 件）。うち 32 件が RED（実装が v2.21 に未追随）、105 件は対（有効入力）・ミューテーション対応で PASS。RED の詳細は spec/evidence/sprint-8-red-phase-7.md。

| REQ | 内容 | 件数 | RED |
|---|---|---|---|
| REQ-030 | 夜間勤務はシフト時刻から導出（22:00-23:00 / 21:00-22:30 / 04:00-06:00 / 20:00-06:00 / 00:00-05:00 / 12:00-22:01 / 04:59-12:00 / 24 時間勤務、複数シフト）。対: 09:00-17:00・05:00-22:00 などの境界、18 歳、nightWork=true | 23 | 10 |
| REQ-033 | annualFiscalYears が undefined/キー欠落/null/文字列/数値/オブジェクト: checkEligibility は invalid_input（警備・非警備）、listRenewals は annual_training の invalid 項目（dueOn=年度末）で他の人は通常どおり。対: 配列・空配列 | 28 | 19 |
| REQ-034 | 確認者が Unicode 空白（U+00A0/1680/2000〜200A/2028/2029/202F/205F/3000 と混在）だけなら公開拒否・応募拒否。対: 可視文字あり | 49 | 0 |
| REQ-028 | 警備×spot/referral/security×新任未了 → security_basic_training_missing。対: dispatch・修了済・非警備 | 10 | 0 |
| REQ-032/026 | residence.expiresOn の ''/null は invalid_input。対: undefined・有効日 | 4 | 0 |
| REQ-029 | employmentDays=0 の派遣は日雇派遣。対: age60 例外・31 日 | 3 | 0 |
| REQ-026/037 | 日付の前後空白・改行（生年月日・シフト日・在留期限・新任修了日・busy・入社日）、古い年（0099/0000 は有効 → 3 件 RED、'0000-00-00' ほかは invalid） | 18＋9 | 0＋3 |

注: 件数は同一 describe 内の it.each 展開を含む実測値。FIND-610 は MANIFEST を最新（仕様 v2.21、DB 77 シナリオ・欠番 32）に更新することで対応した。


---

## 第9回追加（仕様 v2.24。s8_talent_req026_034.test.ts 末尾）

| 区分 | REQ / 根拠 | テスト | 件数 | RED |
|---|---|---|---|---|
| A. consentJointUse の型 | REQ-026・SEC-007 | 7 値(invalid_input のみ)＋true/false の対 | 9 | 7 |
| A. workAllowed の型 | REQ-026・SEC-007 | 6 値＋true/false＋residence 無しの対 | 9 | 6 |
| B. 件数の上限 | REQ-026/037・SEC-004 | シフト 367/366、busy 1,001/1,000、validateJobForPublish 367/366 | 6 | 3 |
| B. 上限超過の処理時間(500ms) | SEC-004 | 4 入力形（別の it） | 4 | 4 |
| C. listRenewals の古い年 | REQ-033・FIND-007 | 0001/0050/0099-12-31/0100-01-01/0101 の daysLeft（独立計算）、99/100 の連続性、約 -70 万日の範囲、在留期限 | 8 | 6 |
| D. 夜間勤務のシフト単位 | REQ-030・FIND-004 | 2 つ目のみ・1 つ目のみ・どちらもなし・18 歳の対 | 4 | 0 |
| 合計 | | | 40 | 26 |

注: 依頼文の「約 -738,000 日台」は 2026-06-01 − 0099-12-31 の実際の日数（-703,609）と合わない。テストは独立計算値（-703,609）で厳密比較し、範囲は -704,000〜-703,000 とした。Planner に確認を依頼済み。
