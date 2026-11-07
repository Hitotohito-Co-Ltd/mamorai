# Sprint 8 RED Phase Evidence 第2回（仕様 v2.10）

実行日時: 2026-11-07
TDD-Writer: 赤松 灯 (⑦)
再生成の記録: spec/evidence/sprint-8-test-regeneration.md（第2回）
コマンド: pnpm --filter @mamorai/input-core exec vitest run

## 結果
new-feature-tests: FAIL
  s8_talent_req026_034.test.ts: 136 件中 29 FAIL / 107 PASS

regression-baseline: PASS
  全体: Test Files 1 failed | 42 passed (43)／Tests 29 failed | 568 passed (597)
  s8 を除く既存 42 ファイル: 461 件すべて PASS
  s8 の既存 64 件（第1回の 2 RED を含む）: すべて PASS（第1回の RED 2 件は実装修正で PASS 済み）
  FAIL 29 件は全て第2回で追加した新規テスト。既存テストは 1 件も壊れていない

## FAIL 一覧（29件。実装が v2.10 に未追随。テストは緩めていない）
- [REQ-026] 空のシフト（no_shifts） > noShifts_在籍済みの人でもシフトが空なら no_shifts で不可
- [REQ-026] 空のシフト（no_shifts） > noShifts_在籍していない人でもシフトが空なら no_shifts で不可
- [REQ-026] 空のシフト（no_shifts） > noShifts_公開前チェックはシフトが空なら no_shifts だけを返す
- [REQ-026] 空のシフト（no_shifts） > noShifts_公開前チェック_他の拒否理由と並ぶ（警備×派遣×空シフト）
- [REQ-026] 空のシフト（no_shifts） > noShifts_応募できる案件の一覧からシフトが空の案件は除かれる
- [REQ-033] 在籍中の判定（基準日） > inService_退社予定日が基準日より後なら契約満了が出る
- [REQ-033] 在籍中の判定（基準日） > inService_退社日が基準日当日なら在籍中で契約満了が出る
- [REQ-033] 在籍中の判定（基準日） > inService_入社日が基準日より未来の雇用は契約満了が出ない
- [REQ-033] 在籍中の判定（基準日） > inService_現任教育_退社日が基準日当日の雇用は在籍中なので対象
- [REQ-033] 在籍中の判定（基準日） > inService_現任教育_入社日が基準日より未来の雇用しかない人は対象外
- [REQ-032] details.residenceDaysLeft > residenceDaysLeft_20日後と50日後のシフトでは最小の 20
- [REQ-032] details.residenceDaysLeft > residenceDaysLeft_並びを逆にしても最小の 20（末尾の値を拾う実装を落とす）
- [REQ-032] details.residenceDaysLeft > residenceDaysLeft_60日超のシフト日が混じっても警告対象の最小日数 20 を返す
- [REQ-032] details.residenceDaysLeft > residenceDaysLeft_単一シフトで期限当日なら 0
- [REQ-032] details.residenceDaysLeft > residenceDaysLeft_警告がないとき（61日）はキーが無い
- [REQ-032] details.residenceDaysLeft > residenceDaysLeft_在留情報がない人はキーが無い
- [REQ-031] details.maxDailyHours > maxDailyHours_他社3時間と自社6時間なら 9
- [REQ-031] details.maxDailyHours > maxDailyHours_複数日では最大の日の値（9 と 7 なら 9、7 と 10 なら 10）
- [REQ-031] details.maxDailyHours > maxDailyHours_別の日の勤務は通算しない（自社6時間の日に別日の他社4時間があっても警告なし）
- [REQ-031] details.maxDailyHours > maxDailyHours_ちょうど8時間なら警告なしでキーが無い
- [REQ-031] details.maxDailyHours > maxDailyHours_既存勤務がなく警告もないときキーが無い
- [REQ-031] details.maxDailyHours > maxDailyHours_在留の警告だけのときは maxDailyHours が無く、時間警告だけのときは residenceDaysLeft が無い
- [REQ-029] 日雇派遣の例外の検証 > exceptionInvalid_verifiedOn が空文字なら dispatch_exception_invalid で不可
- [REQ-029] 日雇派遣の例外の検証 > exceptionInvalid_verifiedOn がスラッシュ区切りなら dispatch_exception_invalid で不可
- [REQ-029] 日雇派遣の例外の検証 > exceptionInvalid_verifiedOn が区切りなしなら dispatch_exception_invalid で不可
- [REQ-029] 日雇派遣の例外の検証 > exceptionInvalid_verifiedOn が日付でない文字列なら dispatch_exception_invalid で不可
- [REQ-029] 日雇派遣の例外の検証 > exceptionInvalid_verifiedOn がゼロ埋めなしなら dispatch_exception_invalid で不可
- [REQ-029] 日雇派遣の例外の検証 > exceptionInvalid_verifiedOn がシフト日より後なら不可
- [REQ-029] 日雇派遣の例外の検証 > exceptionInvalid_age60 で本人がシフト日に59歳なら不可（60歳の誕生日の前日）

## 理由の分類
- no_shifts（5件）: checkEligibility が空のシフトで eligible=true を返す。validateJobForPublish が [] を返す。listApplicableJobs が空シフト案件を残す。
- 在籍中の判定（5件）: 退社予定日が基準日より後／退社日が基準日当日の雇用の契約満了が出ない。入社日が基準日より未来の雇用の契約満了・現任教育が出てしまう。現任教育で退社日が基準日当日の人が対象外になっている。
- details（12件）: checkEligibility の戻り値に `details` が無い（residenceDaysLeft / maxDailyHours）。
- dispatch_exception_invalid（7件）: verifiedOn の空文字・不正形式・シフト日より後、age60 の59歳でも例外が認められ eligible=true になる。

## PASS している対のケース（抜粋）
no_shifts の対（シフト1件なら可）／入社日・退社日が基準日当日なら在籍中（契約満了）／residenceDaysLeft・maxDailyHours の警告なしでキー無し／verifiedOn がシフト日当日・前日は可／age60 の60歳当日は可／day_student は59歳でも可／31日以上は例外不要。
これらは現実装でも PASS しており、対の FAIL ケースが「常に不可を返す」実装ではなく本当の欠陥で落ちていることを示す。

## 新規 PASS（RED でないもの）43 件
在留期限の更新手続き・並び順（10）、listApplicableJobs（5/6）、NFR-05 の厳密な件数、t1 から移行した ageOn / fiscalYearOf / shiftsOverlap / スポット登録（13）など。実装が既に仕様どおりのため PASS。ミューテーション生存の対策として仕様の具体値を固定した。

## Planner への差し戻し事項
- start == end（同時刻）の夜勤を 24 時間勤務とみなすか（dailyHours・shiftsOverlap）。
- 同 personId・同日・同 daysLeft の異種項目（契約満了と在留期限）の並びの基準。
- age60 の「シフト日に満60歳以上」の複数シフト日での扱い。
- 暦にない日付を `verifiedOn` の形式不正とみなすか。
- model.ts は v2.10 未更新（`no_shifts` / `dispatch_exception_invalid` の理由コード、`details` が無い）。実装側の対応事項。
