# Cursor での進め方（上番報告 UI とロール）

1タスクずつ、下の依頼文を Cursor のチャットに貼ってください。
各タスクの最後に `pnpm -r test`、管理コンソールと勤務員PWAの両方のビルド、DBの検証（`PGPORT=5439 bash supabase/tests/run_jyoban_rls_check.sh`）を通してから次へ進みます。

前提：ブランチ `feat/roles-jyoban-ui`（ロールと 0411）が main に入っていること。
生体認証（`feat/biometric-passkey`）を先に入れる場合は、0410 → 0411 の順に適用します。

---

## T1 管理コンソールのメニューをロールで出し分ける

```
@docs/design/jyoban-2026-11/DESIGN_SPEC.md の「0. ロールと見え方」に従って、
apps/desktop/src/App.tsx の左メニューに次のタブを追加してください。
- 「本日の現場一覧」 cap: jyoban_board（画面はT2で作るので、いまは空のコンポーネントでよい）
- 「アカウントと権限」 cap: role_management（画面はT4で作る）
ロールの判定は capabilitiesForRole だけで行い、ロール名を直接比較しないでください。
ロール表示は ROLE_LABEL を使ってください。
開発用の直接起動（session なし）は company_admin 相当のままにしてください。
```

## T2 本日の現場一覧（データ）

```
@docs/design/jyoban-2026-11/DESIGN_SPEC.md の「⑦ 本日の現場一覧」の「データ」表の RPC を
supabase/migrations/0413_jyoban_board.sql として作ってください（0412 は位置確認で使用済み）。
- company_jyoban_board(p_date) は本社PC・支店・管理者・運営だけ。支店は担当現場だけ（app_profile_sites。担当なしは全現場）。
- sitepc_jyoban_board(p_session, p_date) は sitepc_resolve でセッションの現場だけ。
- 確認済み（jyoban_acks）の記録も、それぞれの範囲で作る。
- 上番・下番の位置確認の結果（jyoban_reports.geo_status / geo_distance_m）も返す。
- 0411 と同じ書き方（追加のみ・冪等・security definer・search_path 固定・anon/authenticated の権限を明示）。
- supabase/tests/ に検証SQLを追加し、run_jyoban_rls_check.sh に組み込む（本社PCは全現場・支店は担当だけ・現場PCは自現場だけ・他社は0件）。
```

## T3 本日の現場一覧（画面）

```
@docs/design/jyoban-2026-11/DESIGN_SPEC.md の「⑦ 本日の現場一覧」を実装してください。
見た目は @docs/design/jyoban-2026-11/screens/Main.png と Main_確認済み.png、
構造と文言は @docs/design/jyoban-2026-11/html/Main.html に合わせてください。
新規ファイル apps/desktop/src/features/jyoban/JyobanBoard.tsx と jyobanBoardApi.ts を作り、
会社ログインは company_jyoban_board、現場PCは shared/secureRpc.ts の siteRpc('sitepc_jyoban_board') を使ってください。
状態判定と並び順は input-core の computeSlotStatus / sortSlotRows / summarizeSlotStatuses を使い、画面で計算しないでください。
Realtime と1分ごとの再計算で、締切を過ぎたら未連絡に変わるようにしてください。
上部メニューは作らず、既存の左メニューの中に入れてください。
```

## T4 アカウントと権限

```
@docs/design/jyoban-2026-11/DESIGN_SPEC.md の「⑨ アカウントと権限」を実装してください。
見た目は @docs/design/jyoban-2026-11/screens/HQ-Roles.png と HQ-Roles_追加.png、
構造と文言は @docs/design/jyoban-2026-11/html/HQ-Roles.html に合わせてください。
新規ファイル apps/desktop/src/features/roles/RoleManagement.tsx と rolesApi.ts。
RPC は 0411 の company_list_members / company_add_member / company_set_member_role / company_remove_member。
担当現場の選択肢は company_list_jyoban_sites から取得してください。
「外す」は確認の段階を画面内に作ってください（confirm() は使わない）。
エラーは RPC の例外メッセージをそのまま表示してください。
```

## T5 現場設定の見た目更新

```
@docs/design/jyoban-2026-11/DESIGN_SPEC.md の「⑧ 現場設定」に合わせて、
apps/desktop/src/features/jyoban/JyobanSettings.tsx の見た目を
@docs/design/jyoban-2026-11/screens/HQ-Settings.png に寄せてください。
既存の機能（勤務枠の保存・QR発行・共用端末・配置者・電話番号・通知先）とデータ処理は変えないでください。
起床連絡・下番連絡の要否と締切もデザインの出発・上番と同じ形で並べてください。
```

## T6 勤務員アプリ（上番報告）の見た目更新

```
@docs/design/jyoban-2026-11/DESIGN_SPEC.md の「1. 勤務員アプリ」に合わせて、
apps/desktop/src/pwa/jyoban/JyobanApp.tsx と JyobanTab.tsx の見た目を更新してください。
見た目は @docs/design/jyoban-2026-11/screens/Phone-*.png、構造と文言は html/Phone-*.html。
送信・送信待ち（outbox）・時刻判定（reportButtons）・通知・生体認証の処理は変えず、
画面の構成とスタイル（pwa/jyoban/jyoban.css）だけを置き換えてください。
本人登録はスタッフNoに加えて PIN 入力を残してください（DESIGN_SPEC ①の注記）。
```

## T7 仕上げ

```
ロールごとにログインし直して、DESIGN_SPEC の「3. 受入」を確認するためのテスト
（apps/desktop の vitest。メニューの出し分けと、本社PCで設定が出ないこと）を追加してください。
```
