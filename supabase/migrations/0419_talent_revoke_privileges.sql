-- 0419_talent_revoke_privileges.sql — セキュリティ監査 Sprint 8 の SEC-001 / SEC-002（High）
-- 背景: Supabase は新しいテーブルに anon / authenticated へ全権限を既定で付与する。RLS・トリガ・削除ガードは TRUNCATE を見ないため、
--   (SEC-001) `truncate persons cascade` で全会社の人・雇用・応募が消える。
--   (SEC-002) 会社の管理者が job_applications を直接 insert/update/delete でき、同意・決定者・労働条件通知の記録を偽装できる。
-- 内容:
--   1) 人材基盤の新テーブル6つ（groups, persons, job_roles, jobs, job_shifts, job_applications）から、anon / authenticated の
--      TRUNCATE・REFERENCES・TRIGGER 権限を取り消す。
--   2) job_applications の INSERT・UPDATE・DELETE 権限を anon / authenticated から取り消す（読み取りは RLS の下で残す）。
--      応募の作成・確定・取消は、Sprint 9 の REQ-039 で SECURITY DEFINER の RPC として提供する（それまで書き込み手段は無い。画面・API からも使わない）。
-- 安全・冪等: REVOKE のみ（何度実行しても同じ）。テーブル・列・データは変えない。
-- 注意: 既存のテーブル（staff など）の権限は本マイグレーションの対象外。既存システム側の権限は別途確認する（仕様 KR-4）。
-- 依存: 0410〜0418

revoke truncate, references, trigger on public.groups, public.persons, public.job_roles, public.jobs, public.job_shifts, public.job_applications
  from anon, authenticated, public;
revoke insert, update, delete on public.job_applications from anon, authenticated, public;
