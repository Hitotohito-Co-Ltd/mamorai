# 上番報告 UI — Cursor 引き渡しパッケージ（2026-11）

上番報告の画面（勤務員アプリ PWA と管理コンソール）を、Cursor で取り込むための資料一式です。
あわせて、ロール（現場PC・本社PC・支店・権限者・管理者・教育センター）ごとの見え方を定めています。

全体UI（15画面）の資料は `docs/design/ui-2026-11/` にあります。色・文字・状態色・共通ルールはそちらが基準です。
ここでは上番報告とロールに関する画面だけを扱います。

## 入っているもの

| フォルダ / ファイル | 中身 | Cursor での使い方 |
| --- | --- | --- |
| `DESIGN_SPEC.md` | 画面ごとの仕様（利用者・ロール・表示項目・状態・操作・既存コードとの対応・データ） | 実装の指示書。最初に読ませる |
| `CURSOR_TASKS.md` | 実装の順番と、そのまま貼れる Cursor への依頼文 | 1タスクずつ貼って進める |
| `screens/*.png` | 各画面の見た目（2倍解像度） | チャットに添付して「この見た目に合わせて」と指示する |
| `html/*.html` | 各画面を描画した静的HTML（サンプルデータ入り） | 構造・文言・余白の参照元 |
| `prototype/*.html` | ブラウザで動くプロトタイプ | 動きの確認用。`prototype/index.html` から開く |
| `source/*.dc.html` | デザインキャンバスの元ファイル | データの持ち方（`renderVals`）を見るとき |

ルール: `.cursor/rules/mamorai-jyoban.mdc`（上番報告の画面とロールを触るときに自動で読まれる）

## 前提（このブランチで入ったもの）

- ロールと権限: `packages/input-core/src/auth/authz.ts`（`capabilitiesForRole` / `scopeForRole` / `ROLE_LABEL`）
- DB: `supabase/migrations/0411_roles_site_sessions.sql`
  - 会社アカウントのロール5種、支店・権限者の担当現場、アカウントと権限の RPC（管理者のみ）
  - 現場PCのセッション（`app_site_open_session` → `sitepc_*`）。旧 `site_*` は anon から呼べない
  - 勤務員の有給・シフト希望は本人登録した端末から（`worker_*`）
- 画面から呼ぶ共通入口: `apps/desktop/src/shared/secureRpc.ts`（`siteRpc` / `workerRpc`）

## 注意

- 画面の人数・氏名・現場名はサンプルです。`［ ］` はプレースホルダー。実装ではハードコードしない。
- 実在の勤務員の氏名・生年月日・PINをリポジトリに書かない（このリポジトリは公開設定のことがある）。
- モックアップは inline style で書いています。実装では既存の CSS（`styles.css`、`pwa/pwa.css`、`pwa/jyoban/jyoban.css`）のクラスに置き換えてください。
- 作成日：2026-11-18（デザインキャンバス「MAMOR-AI 上番報告 UI案」から書き出し）
