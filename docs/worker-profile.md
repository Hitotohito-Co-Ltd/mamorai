# 勤務員アプリの設定と個人情報（0414）

勤務員アプリの右上⚙から「設定」を開き、個人情報を登録する。ログアウトも設定の中にある。

## 登録できるもの
| 区分 | 項目 | 備考 |
| --- | --- | --- |
| 基本情報 | ふりがな・電話番号・郵便番号・現住所 | 氏名・生年月日は本社／現場PCが登録した値を表示するだけ（生年月日は初期PINの元になるため、本人は変更できない） |
| 顔写真 | 1枚 | 端末のカメラで撮影、または写真から選ぶ。端末内で長辺1024pxのJPEGに縮小してから送る |
| 資格・教育・健康診断 | 警備員検定・指導教育責任者・新任教育・現任教育・健康診断・その他 | 取得日・有効期限・証書の写真（記録ごとに1枚）。期限の判定は `classifyQualification`（30日以内は更新間近） |

マイナンバー・本籍・経歴は扱わない。

## 見られる人と記録
- 本人: 端末シークレット（`worker_by_device`）で本人の分だけ。
- 本社PC・管理者（会社アカウント）: 自社の勤務員。支店は担当現場の勤務員だけ。教育センターは対象外。
- 現場PC: 自現場に配置された勤務員だけ。
- 本人以外が見ると `staff_profile_views`（誰が・何を・いつ）に残る。

表（`staff_profiles` / `staff_credentials` / `staff_images` / `staff_profile_views`）は anon・authenticated に権限を付けず、すべて security definer の RPC 経由。

## 画像の保管
Supabase Storage ではなく、`staff_images`（bytea、1枚約1MBまで）に保存している。
Storage へ書き込むには、端末シークレットを検証してアップロードURLを出すサーバ（Edge Function など）が要るため。
勤務員が増えて容量が足りなくなったら、サーバを用意して Storage に移す（`worker_image_*` / `*_staff_image` の中身だけ差し替えればよい）。
目安: 100人 × 顔1枚＋証書3枚 ≒ 数十〜100MB。

## RPC
- 本人: `worker_profile_get / save`、`worker_credential_save / delete`、`worker_image_save / get / delete`
- 本社PC: `company_staff_profile(p_staff_no)`、`company_staff_image(...)`
- 現場PC: `sitepc_staff_profile(p_session, p_staff_no)`、`sitepc_staff_image(...)`

## 未実装（次の作業）
本社PC・現場PCの管理画面から上の閲覧RPCを呼ぶ画面（勤務員登録画面に「個人情報」を開く導線）。RPCと権限・閲覧記録は検証済み（`supabase/tests/profile_check.sql`）。
