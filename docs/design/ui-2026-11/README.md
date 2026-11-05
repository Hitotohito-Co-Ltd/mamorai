# MAMOR-AI UI案 — Cursor 引き渡しパッケージ

MAMOR-AI 全体UI案（15画面）を、Cursor で実装するための資料一式です。
リポジトリ `Hitotohito-Co-Ltd/mamorai` に置いて、Cursor から参照させてください。

## 入っているもの

| フォルダ / ファイル | 中身 | Cursor での使い方 |
| --- | --- | --- |
| `DESIGN_SPEC.md` | 画面ごとの仕様（目的・URL・利用者・表示項目・状態・操作・既存コードとの対応） | 実装の指示書。最初に読ませる |
| `design-tokens.css` | 色・文字・余白・角丸・状態色の CSS 変数 | `apps/desktop/src/` に取り込み、既存の変数と対応づける |
| `screens/*.png` | 各画面の見た目（2倍解像度） | チャットに添付して「この見た目に合わせて」と指示する |
| `html/*.html` | 各画面を描画した静的HTML（サンプルデータ入り） | 構造・文言・余白の正確な参照元 |
| `prototype/*.html` | ブラウザで動くプロトタイプ（クリックで状態が変わる） | 動きの確認用。`prototype/index.html` から開く |
| `source/*.dc.html` | デザインキャンバスの元ファイル | 通常は不要。データの持ち方（`renderVals`）を見るときに |
| `cursor-rules/mamorai-ui.mdc` | Cursor のプロジェクトルール | リポジトリの `.cursor/rules/` にコピーする |

## 渡し方（おすすめ手順）

1. このフォルダをリポジトリの `docs/design/ui-2026-11/` に置く。
2. `cursor-rules/mamorai-ui.mdc` を `.cursor/rules/mamorai-ui.mdc` にコピーする。
3. Cursor のチャットで、1画面ずつ依頼する。例：

```
@docs/design/ui-2026-11/DESIGN_SPEC.md の「⑥ シフト希望」を実装してください。
見た目は @docs/design/ui-2026-11/screens/App-Shift.png 、
構造と文言は @docs/design/ui-2026-11/html/App-Shift.html に合わせてください。
対象ファイルは apps/desktop/src/pwa/screens/ShiftHope.tsx です。
既存のデータ処理（提出・読み込み）は変えず、見た目と操作だけを置き換えてください。
```

4. 1画面ごとに `pnpm -r test` と両方のビルドを通してから次へ進む。

## 実装の順番（提案）

1. 共通：`design-tokens.css`、管理画面の左メニュー、勤務員アプリの下タブ
2. 勤務員アプリ：②上番報告タブ → ③報告 → ④受付完了（実装済み画面の見た目更新）
3. 勤務員アプリ：⑥シフト希望・⑦有給申請・⑧講習会・⑨お知らせ（既存画面の見た目更新）
4. 管理画面：施設責任者の配置状況 → 支店 → 本部（新規。データは上番報告の既存テーブルから）
5. 新機能：⑤代理報告、下番報告、補填・欠時間（DB の追加が必要）

## 注意

- 画面の人数・件数・氏名・支店名はすべてサンプルです。実装ではハードコードせず、DB・既存APIから取得してください。
- `［氏名］` `［現場名］` `［支店A］` などの角括弧はプレースホルダーです。
- モックアップは確認しやすいよう inline style で書いています。実装では既存の CSS ファイル（`styles.css`、`pwa/pwa.css`、`pwa/jyoban/jyoban.css`）とクラスに置き換えてください。
- 作成日：2026-11-05（デザインキャンバス「MAMOR-AI 全体UI案」の最新版から書き出し）
