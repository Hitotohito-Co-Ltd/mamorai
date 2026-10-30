-- 0408_jyoban_login_device.sql — 勤務員アプリ（/app）のログインで上番報告の端末登録も済ませる
--   勤務員アプリは 会社コード＋スタッフNo＋PIN でログインする（0400/0401 staff_login）。
--   同じ資格情報で上番報告用の端末シークレットを発行し、アプリ内の「上番報告」タブから報告できるようにする。
--   現場は勤務員アプリ内のQR読み取りで登録（端末に記録）し、報告時は従来どおり 現場トークン＋端末シークレット で照合する。
-- PIN照合は 0407 の jyoban_verify_pin（15分5回でロック・失敗は例外でなく error で返す）を共用。
-- 安全・冪等: 追加のみ。依存: 0407。

create or replace function public.jyoban_register_device_login(
  p_company_code text, p_staff_no text, p_pin text, p_user_agent text default null
) returns table(device_secret text, staff_no text, staff_name text, error text)
language plpgsql security definer set search_path = public, extensions as $$
declare v_company uuid; v_check record; v_staff public.staff; v_secret text;
begin
  select c.id into v_company from public.companies c where c.code = p_company_code and c.is_active;
  if v_company is null then raise exception '会社コードが不正です'; end if;
  select * into v_check from public.jyoban_verify_pin(v_company, p_staff_no, p_pin);
  if v_check.error is not null then
    device_secret := null; staff_no := null; staff_name := null;
    error := public.jyoban_pin_message(v_check.error); return next; return;
  end if;
  select * into v_staff from public.staff s where s.id = v_check.staff_id;
  v_secret := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.jyoban_devices(company_id, staff_id, secret_hash, user_agent)
    values (v_company, v_staff.id, encode(extensions.digest(v_secret, 'sha256'), 'hex'), left(p_user_agent, 300));
  device_secret := v_secret; staff_no := v_staff.staff_no; staff_name := v_staff.name; error := null; return next;
end $$;

grant execute on function public.jyoban_register_device_login(text,text,text,text) to anon, authenticated;
