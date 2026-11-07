# Sprint 8 テスト再生成記録

再生成日: 2026-11-07
担当: TDD-Writer 赤松 灯 (⑦)
対象ファイル: packages/input-core/src/__tests__/s8_talent_req026_034.test.ts（この1ファイルのみ編集。他のテストは未変更）

## 再生成の理由
仕様 v2.6「追補のインターフェース契約」で、関数の戻り値の形と境界が確定した。初回テストは仕様に無い形（`{valid, reasons}`、`type`/`deadline`、日付の数え間違い、仕様と逆の同意の扱い）を作り出していたため、仕様どおりに書き直した。実装コード（eligibility.ts / renewal.ts）と既存の t1_talent.test.ts は読んでいない。

## 承認の根拠
- Planner（白木 咲）が behavioral-spec.md に v2.6「追補のインターフェース契約」と「境界の確定」を追加した。
- Spec-Validator の再承認は並行して実施中（本記録の時点では未了。承認が出なかった場合は本再生成を取り消す）。
- 同意の扱い（どの案件にも応募不可）は保守側の仮確定。OQ-12 で RYUGEN・弁護士の確認が必要。

## どの REQ が変わったか
| REQ | 変更 | 根拠 |
|---|---|---|
| REQ-026 | checkEligibility の呼び出しを3引数 (person, job, busy) に統一（4つ目の日付引数を削除）。テスト内容は不変 | 契約表 |
| REQ-027 | validateJobForPublish の戻り値を `EligibilityReason[]` として検証（空=公開可） | 契約表 |
| REQ-032 | 基準をシフト日に。日数 60=警告 / 61=警告なし / 0=警告 / -1=拒否 の対にした | v2.6 境界の確定 |
| REQ-033 | フィールドを personId, kind, dueOn, daysLeft, urgency に。除外テストごとに対の「含まれる」ケースを追加。並び順は personId の並びで検証。30日ちょうど=含む / 31日=含まない の対 | 契約表 |
| REQ-034 | validateJobForPublish を `EligibilityReason[]` として検証。警備×派遣×線引きなしの複合ケースを追加 | 契約表 |
| REQ-035 | 「同意なしでも自社の案件は応募可」を「同意なしは自社の案件でも no_consent で不可」に書き換え。対（同意ありなら可）を追加 | v2.6 同意の確定 |

## 再生成・追加したテスト名
REQ-027（3件を書き換え）
- securityDispatch_警備×派遣の案件は公開前チェックで拒否される（`['security_dispatch_forbidden']`）
- securityDispatch_警備×直接雇用は登録可（`[]`）
- securityDispatch_非警備×派遣は登録可（`[]`）

REQ-034（3件を書き換え、1件追加）
- boundaryCheck_確認が必要で記録がない案件は公開拒否（`['boundary_not_confirmed']`）
- boundaryCheck_確認が必要で記録がある案件は公開可
- boundaryCheck_確認不要な案件は記録なしでも公開可
- boundaryCheck_警備×派遣かつ線引き記録なしは両方の理由コードで拒否される【新規】

REQ-032（2件を4件に）
- residence_シフト日から在留期限まで60日ちょうどは警告付きで可
- residence_シフト日から在留期限まで61日は警告なしで可
- residence_シフト日が期限当日（日数0）は警告付きで可【新規】
- residence_シフト日が期限の翌日（日数-1）は拒否され警告は出ない【新規】
（旧「期限60日以内に迫る場合は警告付き可（60日ちょうど）」「期限61日後は警告なし」は削除。日数が実は44日・61日ではなかった）

REQ-033（8件を12件に）
- list_単数_1件の更新手続きを返す
- allRetired_全雇用が退社済みの人は現任教育の更新対象外（仕様確定）
- allRetired_対_在籍中の雇用が1件でもあれば現任教育は更新対象【新規】
- noBasic_新任教育未修了の人は現任教育の更新対象外
- noBasic_対_新任修了済みで現任未了なら現任教育は更新対象【新規】
- newlyBasic_今年度に新任修了した人は現任教育の更新対象外
- newlyBasic_対_年度末前日(2026-03-31)に新任修了した人はFY2026では現任教育が更新対象【新規】
- contractEnd_退社済みの雇用の契約満了は対象外
- contractEnd_対_在籍中の雇用の契約満了は30日以内なら含む
- sort_期限切れが先頭_次いで期限が近い順
- filter_期限まで31日の契約満了は一覧に含まない
- filter_対_期限まで30日ちょうどの契約満了は一覧に含む【新規】

REQ-035（1件を書き換え、1件追加）
- noConsent_同意なしは自社の案件でも no_consent で不可（v2.6: どの案件にも応募不可）
- noConsent_対_同意ありなら同じ自社の案件は応募可【新規】

REQ-026（呼び出し形のみ変更、期待値は不変）: 全 checkEligibility 呼び出し（36箇所）を3引数に統一。

件数: 56 → 64（書き換え・追加 計 18件、うち新規追加 8件）。

---

# 第2回 再生成（仕様 v2.10）

再生成日: 2026-11-07
担当: TDD-Writer 赤松 灯 (⑦)
対象ファイル: packages/input-core/src/__tests__/s8_talent_req026_034.test.ts（この1ファイルのみ編集。t1_talent.test.ts は未編集）
読んだもの: 仕様 v2.10、model.ts、index.ts、t1_talent.test.ts（旧テストの固有ケース調査のみ）。実装（eligibility.ts / renewal.ts）は読んでいない。

## 変わった REQ と根拠
- 根拠: Adversary(Sprint 8) の FIND-004 / 005 / 006 / 007 / 009 と、これを受けた仕様 v2.10（Planner が確定。Spec-Validator 第5回 APPROVED の版に対する追補）。承認の連鎖は 仕様 v2.10 → TDD-Writer。
- REQ-026 / REQ-037（FIND-004）: 空のシフトは `no_shifts`。
- REQ-033（FIND-005）: 在籍中の定義（入社日 ≤ 基準日 かつ 退社日なし or 退社日 ≥ 基準日）。契約満了と現任教育の両方。
- REQ-031 / REQ-032（FIND-006）: `details.maxDailyHours` / `details.residenceDaysLeft`。
- REQ-029（FIND-007）: 例外の検証 `dispatch_exception_invalid`。
- REQ-033 / REQ-026 / NFR-05（FIND-009 ミューテーション生存）: 在留期限の更新手続き、期限切れの daysLeft、同日の personId 昇順、`listApplicableJobs`、NFR-05 の結果検証を厳密な値に。

## 再生成・追加したテストID（it 名は test ファイル）
| describe | 件数 |
|---|---|
| [REQ-026] 空のシフト（no_shifts） | 7（新規） |
| [REQ-033] 在籍中の判定（基準日） | 11（新規） |
| [REQ-032] details.residenceDaysLeft | 6（新規） |
| [REQ-031] details.maxDailyHours | 6（新規） |
| [REQ-029] 日雇派遣の例外の検証 | 13（新規。it.each 5 を含む） |
| [REQ-033] 在留期限の更新手続きと並び順 | 10（新規） |
| [REQ-026] listApplicableJobs | 6（新規） |
| t1 から移行（ageOn 2 / fiscalYearOf 2 / shiftsOverlap 5 / スポット登録 3 / 在留24日 1） | 13（新規） |
| [NFR-05] performance_1000人分_結果が…500件ちょうど | 1（`length >= 500` の弱い下限を置換） |
| [REQ-029] dailyDispatch_30日の派遣で例外あり（60歳以上）_可 | 1（Arrange の修正。下記） |

件数: 64 → 136（新規 72）。

## 既存テストの扱い
- 緩めたアサーションは 0 件。
- 修正 1 件: `dailyDispatch_30日の派遣で例外あり（60歳以上）_可` は、36歳の人に age60 の例外を付けていた。v2.10 では age60 は満60歳以上が条件のため、Arrange が仕様に反していた（テスト設計の欠陥）。生年月日を 1960-01-01（66歳）にした。期待値（eligible=true）は不変。
- NFR-05 の結果検証は、`length >= 500` から「500 件ちょうど、契約満了250（残10日）が先、現任教育250（残26日）が後、それぞれ personId 昇順」の完全一致に置換（強化）。

## 書かなかったもの（仕様が決めていない。Planner への差し戻し）
- start == end（同時刻）の夜勤を 24 時間勤務とみなすか。
- 同 personId・同日・同 daysLeft の異種項目（契約満了と在留期限）の並びの基準。
- age60 の「シフト日に満60歳以上」の複数シフト日での扱い。
- 暦にない日付（2026-13-45）を形式不正とみなすか。
