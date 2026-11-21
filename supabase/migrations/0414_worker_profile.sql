-- 0414_worker_profile: 勤務員アプリの「設定」— 個人情報（基本情報・顔写真・資格／教育／健診の記録）
-- 依存: 0400（staff / staff_sites / sites）、0409（staff.phone）、0411（app_profiles / sitepc_resolve / worker_by_device）、0413（app_can_watch_site / app_actor_label）。
-- 方針: 追加のみ・冪等。表は直接読み書きさせず、すべて security definer の RPC 経由（anon/authenticated に表の権限は付けない）。
--   ・本人: 端末シークレット（worker_by_device）で本人だけ
--   ・本社PC・管理者・支店: 会社の勤務員（支店は担当現場の勤務員）。教育センターは対象外
--   ・現場PC: 自現場に配置された勤務員だけ
--   ・本人以外が見たら staff_profile_views に記録する（誰が・何を・いつ）
-- 写真・証書の画像は、端末側で縮小（約1MB以内）したものを bytea で保存する（Storage は書き込み用のサーバが要るため、今回は使わない）。
-- 生年月日は staff.dob（本社・現場PCが登録）を表示するだけで、勤務員は変更できない（初期PINの元になるため）。

-- ── 1) 表 ─────────────────────────────────────────────────────────
create table if not exists public.staff_profiles (
  staff_id    uuid primary key references public.staff(id) on delete cascade,
  company_id  uuid not null references public.companies(id),
  furigana    text,
  postal_code text,
  address     text,
  updated_at  timestamptz not null default now(),
  constraint staff_profiles_furigana_len check (furigana is null or char_length(furigana) <= 60),
  constraint staff_profiles_postal_fmt   check (postal_code is null or postal_code ~ '^[0-9]{3}-?[0-9]{4}$'),
  constraint staff_profiles_address_len  check (address is null or char_length(address) <= 200)
);

create table if not exists public.staff_credentials (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  staff_id    uuid not null references public.staff(id) on delete cascade,
  kind        text not null,
  label       text,
  obtained_on date,
  expires_on  date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint staff_credentials_kind check (kind in ('kentei', 'shido', 'shinnin', 'genin', 'kenshin', 'other')),
  constraint staff_credentials_label_len check (label is null or char_length(label) <= 60),
  constraint staff_credentials_dates check (obtained_on is null or expires_on is null or expires_on >= obtained_on)
);
create index if not exists staff_credentials_staff_idx on public.staff_credentials(staff_id);

create table if not exists public.staff_images (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  staff_id      uuid not null references public.staff(id) on delete cascade,
  kind          text not null,
  credential_id uuid references public.staff_credentials(id) on delete cascade,
  mime          text not null,
  data          bytea not null,
  updated_at    timestamptz not null default now(),
  constraint staff_images_kind check (kind in ('face', 'credential')),
  constraint staff_images_mime check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  constraint staff_images_size check (octet_length(data) between 1 and 1100000),
  constraint staff_images_link check ((kind = 'face' and credential_id is null) or (kind = 'credential' and credential_id is not null))
);
create unique index if not exists staff_images_face_uq on public.staff_images(staff_id) where kind = 'face';
create unique index if not exists staff_images_cred_uq on public.staff_images(credential_id) where kind = 'credential';

create table if not exists public.staff_profile_views (
  id          bigint generated always as identity primary key,
  company_id  uuid not null,
  staff_id    uuid not null,
  viewer_kind text not null,           -- 'hq' | 'site'
  viewer      text,                    -- 本社はメール、現場PCは現場名
  what        text not null,           -- 'profile' | 'face' | 'credential'
  viewed_at   timestamptz not null default now()
);
create index if not exists staff_profile_views_staff_idx on public.staff_profile_views(staff_id, viewed_at desc);

alter table public.staff_profiles      enable row level security;
alter table public.staff_credentials   enable row level security;
alter table public.staff_images        enable row level security;
alter table public.staff_profile_views enable row level security;
revoke all on public.staff_profiles, public.staff_credentials, public.staff_images, public.staff_profile_views from anon, authenticated;

-- ── 2) 共通の材料（内部用。直接は呼べない）────────────────────────────
create or replace function public.staff_profile_json(p_staff uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'staff_no', s.staff_no, 'name', s.name, 'dob', s.dob, 'phone', s.phone,
    'furigana', p.furigana, 'postal_code', p.postal_code, 'address', p.address,
    'has_face', exists (select 1 from public.staff_images i where i.staff_id = s.id and i.kind = 'face'),
    'credentials', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'kind', c.kind, 'label', c.label, 'obtained_on', c.obtained_on, 'expires_on', c.expires_on,
               'has_image', exists (select 1 from public.staff_images i where i.credential_id = c.id))
             order by c.expires_on nulls last, c.created_at)
        from public.staff_credentials c where c.staff_id = s.id), '[]'::jsonb))
    from public.staff s left join public.staff_profiles p on p.staff_id = s.id
   where s.id = p_staff;
$$;

create or replace function public.staff_image_b64(p_staff uuid, p_kind text, p_credential uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('mime', i.mime, 'base64', replace(encode(i.data, 'base64'), E'\n', ''))
    from public.staff_images i
   where i.staff_id = p_staff and i.kind = p_kind
     and (p_kind = 'face' or i.credential_id = p_credential);
$$;

-- ── 3) 本人（勤務員アプリ。端末シークレットで本人確認）──────────────────
create or replace function public.worker_profile_get(p_device_secret text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare w record;
begin
  select * into w from public.worker_by_device(p_device_secret);
  return public.staff_profile_json(w.staff_id);
end $$;

create or replace function public.worker_profile_save(
  p_device_secret text, p_furigana text, p_postal_code text, p_address text, p_phone text
) returns void language plpgsql security definer set search_path = public as $$
declare w record; v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[-\s]', '', 'g'), '');
begin
  select * into w from public.worker_by_device(p_device_secret);
  if v_phone is not null and v_phone !~ '^(\+[1-9][0-9]{7,14}|0[0-9]{9,10})$' then raise exception '電話番号の形式が正しくありません（例: 09012345678）'; end if;
  if nullif(btrim(p_postal_code), '') is not null and btrim(p_postal_code) !~ '^[0-9]{3}-?[0-9]{4}$' then raise exception '郵便番号の形式が正しくありません（例: 123-4567）'; end if;
  insert into public.staff_profiles(staff_id, company_id, furigana, postal_code, address, updated_at)
    values (w.staff_id, w.company_id, nullif(btrim(p_furigana), ''), nullif(btrim(p_postal_code), ''), nullif(btrim(p_address), ''), now())
  on conflict (staff_id) do update
    set furigana = excluded.furigana, postal_code = excluded.postal_code, address = excluded.address, updated_at = now();
  update public.staff set phone = v_phone where id = w.staff_id;
end $$;

create or replace function public.worker_credential_save(
  p_device_secret text, p_id uuid, p_kind text, p_label text, p_obtained_on date, p_expires_on date
) returns uuid language plpgsql security definer set search_path = public as $$
declare w record; v_id uuid;
begin
  select * into w from public.worker_by_device(p_device_secret);
  if p_kind not in ('kentei', 'shido', 'shinnin', 'genin', 'kenshin', 'other') then raise exception '種類が正しくありません'; end if;
  if p_expires_on is not null and p_obtained_on is not null and p_expires_on < p_obtained_on then raise exception '有効期限が取得日より前です'; end if;
  if p_id is null then
    if (select count(*) from public.staff_credentials c where c.staff_id = w.staff_id) >= 30 then raise exception '登録できる記録は30件までです'; end if;
    insert into public.staff_credentials(company_id, staff_id, kind, label, obtained_on, expires_on)
      values (w.company_id, w.staff_id, p_kind, nullif(btrim(p_label), ''), p_obtained_on, p_expires_on) returning id into v_id;
  else
    update public.staff_credentials set kind = p_kind, label = nullif(btrim(p_label), ''), obtained_on = p_obtained_on,
           expires_on = p_expires_on, updated_at = now()
     where id = p_id and staff_id = w.staff_id returning id into v_id;
    if v_id is null then raise exception '記録が見つかりません'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.worker_credential_delete(p_device_secret text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare w record;
begin
  select * into w from public.worker_by_device(p_device_secret);
  delete from public.staff_credentials where id = p_id and staff_id = w.staff_id;
end $$;

-- 画像の保存（顔写真は1枚、証書は記録ごとに1枚。上書き）。base64 は約1MB（変換後）まで
create or replace function public.worker_image_save(
  p_device_secret text, p_kind text, p_credential_id uuid, p_mime text, p_base64 text
) returns void language plpgsql security definer set search_path = public, extensions as $$
declare w record; v_data bytea;
begin
  select * into w from public.worker_by_device(p_device_secret);
  if p_kind not in ('face', 'credential') then raise exception '種類が正しくありません'; end if;
  if p_mime not in ('image/jpeg', 'image/png', 'image/webp') then raise exception '画像の形式は JPEG・PNG・WebP です'; end if;
  if p_base64 is null or length(p_base64) > 1500000 then raise exception '画像が大きすぎます。撮り直してください'; end if;
  begin v_data := decode(p_base64, 'base64'); exception when others then raise exception '画像を読み取れませんでした'; end;
  if octet_length(v_data) < 1 then raise exception '画像を読み取れませんでした'; end if;
  if p_kind = 'credential' then
    if p_credential_id is null or not exists (select 1 from public.staff_credentials c where c.id = p_credential_id and c.staff_id = w.staff_id) then
      raise exception '記録が見つかりません';
    end if;
    insert into public.staff_images(company_id, staff_id, kind, credential_id, mime, data)
      values (w.company_id, w.staff_id, 'credential', p_credential_id, p_mime, v_data)
    on conflict (credential_id) where kind = 'credential' do update set mime = excluded.mime, data = excluded.data, updated_at = now();
  else
    insert into public.staff_images(company_id, staff_id, kind, mime, data)
      values (w.company_id, w.staff_id, 'face', p_mime, v_data)
    on conflict (staff_id) where kind = 'face' do update set mime = excluded.mime, data = excluded.data, updated_at = now();
  end if;
end $$;

create or replace function public.worker_image_get(p_device_secret text, p_kind text, p_credential_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare w record;
begin
  select * into w from public.worker_by_device(p_device_secret);
  return public.staff_image_b64(w.staff_id, p_kind, p_credential_id);
end $$;

create or replace function public.worker_image_delete(p_device_secret text, p_kind text, p_credential_id uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare w record;
begin
  select * into w from public.worker_by_device(p_device_secret);
  delete from public.staff_images where staff_id = w.staff_id and kind = p_kind and (p_kind = 'face' or credential_id = p_credential_id);
end $$;

-- ── 4) 本社PC・管理者・支店（見たら記録）─────────────────────────────
create or replace function public.app_can_view_staff(p_staff uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff s join public.app_profiles p on p.company_id = s.company_id and p.user_id = auth.uid()
     where s.id = p_staff
       and (p.role in ('company_admin', 'hq_operator')
            or (p.role = 'company_manager'
                and (exists (select 1 from public.staff_sites ss where ss.staff_id = s.id and public.app_can_watch_site(ss.site_id))
                     or (s.site_id is not null and public.app_can_watch_site(s.site_id))))));
$$;

create or replace function public.company_staff_profile(p_staff_no text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_staff uuid; v_company uuid;
begin
  select s.id, s.company_id into v_staff, v_company from public.staff s
   where s.staff_no = p_staff_no and s.company_id = public.app_company_id();
  if v_staff is null or not public.app_can_view_staff(v_staff) then raise exception '見られる勤務員ではありません'; end if;
  insert into public.staff_profile_views(company_id, staff_id, viewer_kind, viewer, what)
    values (v_company, v_staff, 'hq', public.app_actor_label(), 'profile');
  return public.staff_profile_json(v_staff);
end $$;

create or replace function public.company_staff_image(p_staff_no text, p_kind text, p_credential_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_staff uuid; v_company uuid;
begin
  select s.id, s.company_id into v_staff, v_company from public.staff s
   where s.staff_no = p_staff_no and s.company_id = public.app_company_id();
  if v_staff is null or not public.app_can_view_staff(v_staff) then raise exception '見られる勤務員ではありません'; end if;
  insert into public.staff_profile_views(company_id, staff_id, viewer_kind, viewer, what)
    values (v_company, v_staff, 'hq', public.app_actor_label(), case when p_kind = 'face' then 'face' else 'credential' end);
  return public.staff_image_b64(v_staff, p_kind, p_credential_id);
end $$;

-- ── 5) 現場PC（自現場に配置された勤務員だけ。見たら記録）────────────────
create or replace function public.sitepc_staff_profile(p_session text, p_staff_no text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_c uuid; v_site uuid; v_staff uuid; v_name text;
begin
  select r.company_id, r.site_id into v_c, v_site from public.sitepc_resolve(p_session) r;
  select s.id into v_staff from public.staff s join public.staff_sites ss on ss.staff_id = s.id and ss.site_id = v_site
   where s.company_id = v_c and s.staff_no = p_staff_no;
  if v_staff is null then raise exception 'この現場の勤務員ではありません'; end if;
  select st.name into v_name from public.sites st where st.id = v_site;
  insert into public.staff_profile_views(company_id, staff_id, viewer_kind, viewer, what) values (v_c, v_staff, 'site', v_name, 'profile');
  return public.staff_profile_json(v_staff);
end $$;

create or replace function public.sitepc_staff_image(p_session text, p_staff_no text, p_kind text, p_credential_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_c uuid; v_site uuid; v_staff uuid; v_name text;
begin
  select r.company_id, r.site_id into v_c, v_site from public.sitepc_resolve(p_session) r;
  select s.id into v_staff from public.staff s join public.staff_sites ss on ss.staff_id = s.id and ss.site_id = v_site
   where s.company_id = v_c and s.staff_no = p_staff_no;
  if v_staff is null then raise exception 'この現場の勤務員ではありません'; end if;
  select st.name into v_name from public.sites st where st.id = v_site;
  insert into public.staff_profile_views(company_id, staff_id, viewer_kind, viewer, what)
    values (v_c, v_staff, 'site', v_name, case when p_kind = 'face' then 'face' else 'credential' end);
  return public.staff_image_b64(v_staff, p_kind, p_credential_id);
end $$;

-- ── 6) 権限 ──────────────────────────────────────────────────────
revoke all on function public.staff_profile_json(uuid) from public, anon, authenticated;
revoke all on function public.staff_image_b64(uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.app_can_view_staff(uuid) from public, anon;
revoke all on function public.worker_profile_get(text) from public;
revoke all on function public.worker_profile_save(text,text,text,text,text) from public;
revoke all on function public.worker_credential_save(text,uuid,text,text,date,date) from public;
revoke all on function public.worker_credential_delete(text,uuid) from public;
revoke all on function public.worker_image_save(text,text,uuid,text,text) from public;
revoke all on function public.worker_image_get(text,text,uuid) from public;
revoke all on function public.worker_image_delete(text,text,uuid) from public;
revoke all on function public.company_staff_profile(text) from public, anon;
revoke all on function public.company_staff_image(text,text,uuid) from public, anon;
revoke all on function public.sitepc_staff_profile(text,text) from public;
revoke all on function public.sitepc_staff_image(text,text,text,uuid) from public;
grant execute on function public.app_can_view_staff(uuid) to authenticated;
grant execute on function public.worker_profile_get(text) to anon, authenticated;
grant execute on function public.worker_profile_save(text,text,text,text,text) to anon, authenticated;
grant execute on function public.worker_credential_save(text,uuid,text,text,date,date) to anon, authenticated;
grant execute on function public.worker_credential_delete(text,uuid) to anon, authenticated;
grant execute on function public.worker_image_save(text,text,uuid,text,text) to anon, authenticated;
grant execute on function public.worker_image_get(text,text,uuid) to anon, authenticated;
grant execute on function public.worker_image_delete(text,text,uuid) to anon, authenticated;
grant execute on function public.company_staff_profile(text) to authenticated;
grant execute on function public.company_staff_image(text,text,uuid) to authenticated;
grant execute on function public.sitepc_staff_profile(text,text) to anon, authenticated;
grant execute on function public.sitepc_staff_image(text,text,text,uuid) to anon, authenticated;
