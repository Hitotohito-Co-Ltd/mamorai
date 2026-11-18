# 上番報告 UI 仕様書（実装用・2026-11）

対象リポジトリ：`Hitotohito-Co-Ltd/mamorai`（ブランチ `feat/roles-jyoban-ui` 以降）
見た目：`screens/<画面>.png` ／ 構造と文言：`html/<画面>.html` ／ 色・寸法：`../ui-2026-11/design-tokens.css`

## 0. ロールと見え方

| ロール | 入口 | 見られる範囲 | 上番報告でできること |
| --- | --- | --- | --- |
| 現場PC `site_operator` | `/s` 会社コード＋施設コード＋現場PIN | ログインした現場だけ | 本日の一覧（自現場）・確認済みにする |
| 本社PC `hq_operator` | `/co` メール＋パスワード | 会社の全現場 | 本日の一覧・電話・確認済みにする・CSV出力 |
| 支店・権限者 `company_manager` | `/co` | 担当現場（担当なし＝全現場） | 一覧・確認済み・**現場設定**（担当現場のみ） |
| 管理者 `company_admin` | `/co` | 会社の全現場 | 一覧・確認済み・現場設定・**アカウントと権限** |
| 教育センター `education_center` | `/co` | 会社全体（教育のみ） | 上番報告は見ない（講習会管理・教育） |
| 運営 `platform_admin` | `/tradmin` | 全社 | 上番報告は見ない |

- 画面の出し分けは必ず `capabilitiesForRole(role)` で行う。新しい capability：`jyoban_board`（本日の現場一覧）、`role_management`（アカウントと権限）。設定は従来の `jyoban_settings`。
- データの範囲は `scopeForRole(role)`（`site` / `assigned` / `company` / `platform`）。画面側で絞るだけでなく、**DB（RPC・RLS）が同じ範囲で絞る**ことを前提にする。
- ヘッダー右のロール表示は `ROLE_LABEL[role]`（例「本社PC」「管理者」）。

### 0.1 状態と色（一覧・タイル共通）

並び順と名前は input-core の `JYOBAN_STATUS_ORDER` / `sortSlotRows` / `summarizeSlotStatuses` に従う。

| 画面の表示 | 意味 | 色（`--mm-*`） |
| --- | --- | --- |
| 未連絡 | 締切＋猶予を過ぎて報告がない | alert（赤）。行も薄い赤 |
| 遅刻等の報告 | その他の報告（遅刻・寝坊・交通遅延・体調不良・欠勤） | late（橙） |
| 出発済み | 出発連絡あり・上番前 | 青（`--mm-info-*` がなければ fill を使う） |
| 締切前 | まだ締切前 | neutral（灰） |
| 上番済み | 上番連絡あり | ok（緑） |
| 確認済み | 本社・現場が「確認済みにする」を押した | ok＋枠 |

起床連絡・下番連絡（0409で追加）も列として出す。出発連絡と同じ「時刻／締切」の2段表示。

---

## 1. 勤務員アプリ（スマホ 390×844・QRから起動）

既存の実装：`apps/desktop/src/pwa/jyoban/JyobanApp.tsx`（QR → 報告）、`JyobanTab.tsx`（勤務員アプリの上番報告タブ）、`pwa/WorkerApp.tsx`（ログイン）。
**ロジック（送信・送信待ち・時刻判定・通知・生体認証）は変えず、見た目と画面の流れを置き換える。**

### ① 本人登録 — `Phone-Register`（2段階）
- 1 スタッフNo入力 → 2 「ご本人ですか？」で氏名と本日の配置を確認 → 登録。
- 既存は「スタッフNo＋PIN」で登録している（`jyoban_register_device_login`）。**PIN入力欄は残す**（スタッフNoだけでの登録はなりすましできるため。0411でPINは5回失敗で15分ロック）。デザインの1段目に PIN 欄を足す。
- 入力ミスが続いたときの文言：`jyoban_pin_message('locked')` の文言をそのまま出す。

### ② 報告ホーム — `Phone-Home`
- ヘッダー：現場名・日付・勤務枠・オンライン状態（オフライン時は「電波なし（送信待ち n件）」）。
- 本人カード：氏名・スタッフNo・「本人登録済み」、右に「別の人で登録」。
- 済みの報告は緑のカード（時刻・締切）。次に押すべき報告を大きなボタン1つで出す（`reportButtons` の順：起床 → 出発 → 上番 → 下番。不要な報告は出さない）。
- 下に「その他の報告（遅刻・寝坊など）」。
- 生体認証の案内（`feat/biometric-passkey` を取り込んだ後）：現場の設定が「必須／任意」のとき、未登録なら「顔・指紋を登録」カード、送信待ちが本人確認待ちなら「顔・指紋で確認して送信」。

### ③ 確認 — `Phone-Confirm`（ボトムシート）
- 「上番連絡を報告しますか？」＋現場・勤務枠・氏名・時刻。主ボタン「はい」高さ72px、「いいえ」60px。
- 生体認証が必要な現場では「はい」で顔・指紋の確認を出してから送る。

### ④ 送信完了 — `Phone-Done`
- 送信済み／送信待ち（オフライン）を区別して表示。送信待ちは「つながったら自動で送ります」。

### ⑤ その他の報告 — `Phone-Other`
- 種別（`JYOBAN_OTHER_KINDS`）・到着見込み（必要な種別のみ）・メモ。入力チェックは `validateOtherReport`。

### ⑥ 現場スマホ（共用） — `Phone-Shared`
- 現場に置いた共用端末。毎回スタッフNo＋PINで本人を選ぶ。氏名を端末に保存しない。

---

## 2. 管理コンソール（PC 1440）

既存の実装：`apps/desktop/src/App.tsx`（左メニュー・タブ）、`features/jyoban/JyobanSettings.tsx`（現場設定）。
デザインは上部メニューだが、**既存の左メニュー（`ui-2026-11` の骨組み）に合わせる**。

### ⑦ 本日の現場一覧 — `Main`（新規・capability `jyoban_board`）
- 利用：現場PC（自現場）・本社PC・支店（担当現場）・管理者。
- 見出し：対象現場数・「● リアルタイム更新中（最終受信 hh:mm）」。検索（現場名・氏名）・区分・日付・CSV出力。
- 赤い帯：未連絡 n件。先頭の1件を出し「［氏名］さんに電話」（`tel:` リンク。電話番号は `jyoban_slot_staff` / `staff.phone`。番号がなければ出さない）。
- 状態タイル6つ（押すとその状態で絞り込み・もう一度で解除。`aria-pressed`）。件数は `summarizeSlotStatuses`。
- 一覧の列：ステータス／現場／区分／勤務枠／配置者（スタッフNo、勤務表と別人が報告したら「交代」の注記）／起床／出発／上番／下番／その他の報告／対応。
- 対応：未連絡＝「電話」「確認済みにする」、遅刻等＝「確認済みにする」、確認済み＝「hh:mm ［担当者］確認」。確認済みは `jyoban_acks`（slot×日付で1件）。
- 並び順：`sortSlotRows`。状態判定：`computeSlotStatus`（画面で計算しない）。
- 更新：Supabase Realtime（`jyoban_reports` / `jyoban_acks`）＋1分ごとの再計算（締切を過ぎた瞬間に赤くするため）。

**データ（Cursor で追加する RPC。0412 として作る）**

| 呼び出し元 | RPC | 中身 |
| --- | --- | --- |
| 本社PC・支店・管理者 | `company_jyoban_board(p_date date)` | 範囲内の現場の勤務枠・配置者・当日の報告・確認。支店は担当現場だけ（`app_can_manage_site` と同じ考え方で「見る」範囲を決める関数を用意） |
| 現場PC | `sitepc_jyoban_board(p_session text, p_date date)` | セッションの現場だけ |
| 確認済み | `company_jyoban_ack(p_slot_id, p_date, p_memo)` / `sitepc_jyoban_ack(p_session, …)` | `jyoban_acks` に記録。範囲外は拒否 |

### ⑧ 現場設定 — `HQ-Settings`（既存画面の見た目更新・capability `jyoban_settings`）
- 利用：管理者（全現場）・支店（担当現場）。本社PC・教育センターには出さない（DB側でも 0411 で拒否される）。
- 左：現場一覧（検索・区分・休止中は灰色）。右：基本情報（現場名・区分・稼働中・共用端末）、報告用QR（印刷用PDF・再発行）、勤務枠と報告時刻（起床・出発・上番・下番の要否と締切、猶予）、日別の配置者（勤務表xlsxの取込）。
- 既存の `JyobanSettings.tsx` の機能（勤務枠の保存・QR発行・共用端末・配置者・電話番号・通知先）はすべて残す。
- 生体認証（`feat/biometric-passkey`）を取り込んだら「顔・指紋の本人確認（使わない／使える人は使う／必須）」をこのカードに置く。

### ⑨ アカウントと権限 — `HQ-Roles`（新規・capability `role_management`＝管理者のみ）
- 役割の説明カード5枚（管理者・支店・権限者・本社PC・教育センター・現場PC）。文言は `html/HQ-Roles.html`。
- メンバー一覧：メール／役割（色チップ）／担当現場（支店・権限者のみ）／操作（役割を変える・外す）。自分の行は「自分の役割は変えられません」。
- メンバーを追加：メール＋役割（＋支店なら担当現場の複数選択）。Auth で招待済みのメールだけ追加できる（RPC がそう返す）。
- 現場PCの説明（メールアカウントではない・12時間・10回でロック）と「現場設定を開く」。
- 変更の記録：`app_role_audit` の最新20件。

| 操作 | RPC（0411） |
| --- | --- |
| 一覧 | `company_list_members()` → `user_id, email, role, site_ids, is_me` |
| 追加 | `company_add_member(p_email, p_role, p_site_ids)` |
| 役割の変更 | `company_set_member_role(p_user_id, p_role, p_site_ids)` |
| 外す | `company_remove_member(p_user_id)` |
| 変更の記録 | `app_role_audit` を select（管理者のみ見える RLS） |

エラー文言は RPC の例外メッセージをそのまま出す（日本語で返る）。

---

## 3. 受入（画面ごと）

- ロールを切り替えて、各ロールで出るメニューが §0 の表どおりであること（`authz.test.ts` と同じ組み合わせ）。
- 本社PCでログインし、現場設定を開けない・URL直打ちでも保存できない（DBが拒否）こと。
- 現場PCで他現場のデータが出ないこと。12時間使わないとログイン画面に戻ること（`SITE_SESSION_EXPIRED`）。
- 一覧：締切＋猶予を過ぎた瞬間に「未連絡」へ移ること（時刻を固定したテストで確認）。
- 文字は 4.5:1 以上、押せる要素は 44px 以上、`<button>` / `<a>` を使う。
