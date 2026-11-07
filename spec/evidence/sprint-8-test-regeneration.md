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


---

# 追加 第3回（仕様 v2.11）

追加日: 2026-11-07 / 担当: TDD-Writer 赤松 灯 (⑦) / 対象: s8_talent_req026_034.test.ts のみ（実装は未読・未編集、既存テストは未変更）

## 根拠
Planner が v2.11 で、上記「書かなかったもの」4点を確定した（「追補のインターフェース契約」の境界の確定、REQ-029/031 の本文）。承認: RYUGEN による v2.11 の確定（呼び出し元の指示による）。

## どの REQ が変わったか・追加したテスト
| REQ | 確定内容 | 追加 |
|---|---|---|
| REQ-031 | 終了時刻が開始時刻と同じシフトは24時間勤務（翌日に終わる）。重なりと通算に使う | 8件 |
| REQ-033 | 同順位は personId 昇順、それも同じなら contract→annual_training→residence | 4件 |
| REQ-029 | age60 は全シフト日で満60歳以上。確認日も全シフト日以前 | 6件 |
| REQ-029 | verifiedOn は暦に存在する YYYY-MM-DD。存在しない日は dispatch_exception_invalid | 10件 |

件数: 136 → 164（新規 28）。緩めた・変更した既存アサーションは 0 件。

## 結果
実装は既に準拠していたため、28件とも初回から PASS（仕様の後追い。RED なし）。input-core 全体 596 件 PASS、回帰なし。

「書かなかったもの」4点は、本節の追加で全て解消した。


---

# 追加 第4回（仕様 v2.13）

追加日: 2026-11-07 / 担当: TDD-Writer 赤松 灯 (⑦) / 対象: s8_talent_req026_034.test.ts のみ（実装・マイグレーションは未読・未編集、既存テストは未変更）

## 根拠
Adversary 第2回の FIND-104/105/106/107/108/111 と、Planner が確定した仕様 v2.13（「追補のインターフェース契約」の境界の確定）。承認: 呼び出し元の指示（v2.13 の確定）による。

## どの REQ が変わったか・追加したテスト
| REQ | 確定内容 | 追加 |
|---|---|---|
| REQ-026/037 | 不正な日付・employmentDays は invalid_input で拒否 | 26件 |
| REQ-029 | 例外区分 kind が列挙外なら dispatch_exception_invalid | 5件 |
| REQ-032 | residence_invalid があるとき residence_expiring の警告・residenceDaysLeft を返さない | 4件 |
| REQ-034 | 確認者が空白でなく確認日が暦の日付のときだけ記録あり | 11件 |
| REQ-033 | 基準日より後に新任を修了する人は現任教育の対象外／同順位は personId のコードポイント順 | 6件 |
| REQ-031 | 日またぎ勤務は全時間を始業日に計上 | 4件 |
| REQ-026/028/031/032 | ミューテーション生存（Adversary 実測）の境界 | 11件 |

件数: 164 → 231（新規 67）。緩めた・変更した既存アサーションは 0 件。
併せて MANIFEST.md の仕様バージョン、REQ-035 の DB 表（23 シナリオ）、解決済みの Planner 差し戻しの削除を FIND-112 に沿って実態に合わせた。

---

# 追加 第5回（仕様 v2.15）

追加日: 2026-11-07 / 担当: TDD-Writer 赤松 灯 (⑦) / 対象: s8_talent_req026_034.test.ts のみ（実装・マイグレーション・DB の SQL テストは未編集、既存テストは未変更）

## 根拠
Adversary 第3回の FIND-302/303/304/305/309 と、Planner が確定した仕様 v2.15（「追補のインターフェース契約」の境界の確定。invalid_input の3分類、listRenewals の invalid 項目、コードポイント順）。承認: 呼び出し元の指示（v2.15 の確定）による。

## どの REQ が変わったか・追加したテスト
| REQ | 確定内容 | 追加 |
|---|---|---|
| REQ-026/037 | 時刻（シフト・busy）と busy 日付、雇用の入社日/退社日（空文字を含む）の不正は invalid_input | 35件 |
| REQ-033 | 不正な期限日・雇用日の項目は消さず urgency=invalid, daysLeft=null で先頭／基準日不正は RangeError | 10件 |
| REQ-033 | personId はコードポイント順（BMP 外を含む）／同一 personId の並びは kind 順で入力順に依らない | 9件 |
| REQ-028/034/033 | ミューテーション生存への対応（警備×派遣、confirmedBy が数値、就労不可の在留一覧） | 7件 |

件数: 231 → 292（新規 61）。緩めた・変更した既存アサーションは 0 件。
併せて MANIFEST.md の仕様バージョン・件数を v2.15 に同期し、REQ-035 を 035a（Sprint 8）に限定した（FIND-310）。035b は Sprint 9 で未着手。


---

# 追加 第6回（仕様 v2.18）

追加日: 2026-11-07 / 担当: TDD-Writer 赤松 灯 (⑦) / 対象: s8_talent_req026_034.test.ts への追記、t1_talent_purity.test.ts の禁止パターン追加のみ（実装・マイグレーション・DB の SQL テスト・仕様は未編集、既存テストは未変更）

## 根拠
Adversary 第4回の FIND-401（契約満了日の空文字/null）/ FIND-402（basicDoneOn 不正の扱いの穴）/ FIND-403（変異の生存）/ FIND-405（純粋性テストの禁止パターン不足）と、Planner が確定した仕様 v2.18（境界の確定）。承認: 呼び出し元の指示（v2.18 の確定）による。

## どの REQ が変わったか・追加したテスト
| REQ | 確定内容 | 追加 |
|---|---|---|
| REQ-033 | 契約満了日・在留期限が空文字/null は invalid 項目（undefined のみ対象外） | 7件 |
| REQ-026/028/033 | 新任教育の修了日の不正は invalid_input／annual_training の invalid 項目 | 8件 |
| REQ-026/037 | 時刻・日付の形式の厳格化（変異対策） | 22件 |
| REQ-029 | 日雇派遣の判定は派遣のみ | 7件 |
| REQ-033 | 退社日が空文字の雇用、personId 接頭辞の並び | 7件 |
| 純粋性 | 禁止パターン 5 種を追加（テスト数は不変） | 0件 |

件数: 724 → 775（新規 51）。緩めた・変更した既存アサーションは 0 件。
