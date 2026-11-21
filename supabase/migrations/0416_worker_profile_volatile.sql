-- 0416_worker_profile_volatile: 0414 の読み込み RPC の修正
-- worker_profile_get / worker_image_get を stable で宣言していたが、本人確認（worker_by_device）が端末の最終利用時刻を更新するため、
-- Supabase（読み取り専用トランザクションで stable を実行）で "cannot execute UPDATE in a read-only transaction" になった。
-- 更新を伴うので volatile（既定）に直す。中身は 0414 と同じ。追加のみ・冪等（create or replace）。
create or replace function public.worker_profile_get(p_device_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w record;
begin
  select * into w from public.worker_by_device(p_device_secret);
  return public.staff_profile_json(w.staff_id);
end $$;

create or replace function public.worker_image_get(p_device_secret text, p_kind text, p_credential_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w record;
begin
  select * into w from public.worker_by_device(p_device_secret);
  return public.staff_image_b64(w.staff_id, p_kind, p_credential_id);
end $$;

revoke all on function public.worker_profile_get(text) from public;
revoke all on function public.worker_image_get(text,text,uuid) from public;
grant execute on function public.worker_profile_get(text) to anon, authenticated;
grant execute on function public.worker_image_get(text,text,uuid) to anon, authenticated;
