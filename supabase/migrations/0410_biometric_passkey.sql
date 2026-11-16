-- 0410_biometric_passkey.sql — 勤務員アプリの生体認証（WebAuthn パスキー）
--   ・勤務員アプリのログインを、PINの代わりに顔・指紋（端末の生体認証）で行えるようにする。
--   ・上番報告（起床・出発・上番・下番・遅刻等）の送信時に、顔・指紋で本人確認する。
--     現場ごとに 'off'（使わない）/'optional'（できる人はする）/'required'（必須）を選ぶ。
--
-- 仕組み:
--   ・顔・指紋のデータは端末から出ない。サーバーが持つのは パスキーの公開鍵 と 認証回数 だけ。
--   ・パスキーの検証（署名確認）は APIゲートウェイ（server/ の /api/passkey）が行い、
--     ここの RPC を service_role で呼ぶ。勤務員アプリから直接は呼べない（anon/authenticated に権限なし）。
--   ・本人確認に成功すると、その端末（jyoban_devices）に bio_verified_at を記録する。
--     報告の受付時に「5分以内に同じ端末で本人確認したか」を見て jyoban_reports.bio_verified を付け、
--     現場の設定が 'required' なら、確認なしの報告を受け付けない。
--   ・共用端末（現場スマホでスタッフNo＋PIN）からの報告は対象外（本人の鍵がないため）。bio_verified=false で記録。
--
-- 安全・冪等: 追加のみ（ADD COLUMN / CREATE IF NOT EXISTS / CREATE OR REPLACE）。表・列の削除なし。
--   company_list_jyoban_sites は戻り値に列を足すため DROP→CREATE で作り直す（0404 と同じ手順）。
-- 依存: 0400, 0406, 0407, 0409

create extension if not exists pgcrypto with schema extensions;

-- ── 1) 現場ごとの設定・報告の記録・端末の確認時刻 ─────────────────────
alter table public.sites add column if not exists biometric_mode text default 'off';   -- 既存表への追加列はNULL許容（後方互換）。NULLは 'off' 扱い
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sites_biometric_mode_chk') then
    alter table public.sites add constraint sites_biometric_mode_chk
      check (biometric_mode is null or biometric_mode in ('off', 'optional', 'required'));
  end if;
end $$;

alter table public.jyoban_reports add column if not exists bio_verified boolean default false;  -- NULL=判定前の既存報告
alter table public.jyoban_devices add column if not exists bio_verified_at timestamptz;

-- ── 2) パスキー（勤務員×端末）────────────────────────────────────────
create table if not exists public.staff_passkeys (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  staff_id      uuid not null references public.staff(id) on delete cascade,
  device_id     uuid references public.jyoban_devices(id) on delete set null,
  credential_id text not null unique check (credential_id ~ '^[A-Za-z0-9_-]+$' and length(credential_id) between 16 and 1024),  -- base64url
  public_key    text not null check (length(public_key) between 16 and 2048),               -- base64url(COSE)
  counter       bigint not null default 0 check (counter >= 0),
  transports    text[] not null default '{}',
  device_label  text check (device_label is null or length(device_label) <= 300),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
create index if not exists idx_staff_passkeys_staff on public.staff_passkeys(staff_id) where revoked_at is null;

-- 検証用の使い捨てチャレンジ（5分で失効・1回限り）
create table if not exists public.passkey_challenges (
  id         uuid primary key default gen_random_uuid(),
  device_id  uuid not null references public.jyoban_devices(id) on delete cascade,
  purpose    text not null check (purpose in ('register', 'verify')),
  challenge  text not null check (challenge ~ '^[A-Za-z0-9_-]+$' and length(challenge) between 16 and 256),
  expires_at timestamptz not null default now() + interval '5 minutes',
  used_at    timestamptz
);
create index if not exists idx_passkey_challenges_device on public.passkey_challenges(device_id, purpose);

alter table public.staff_passkeys     enable row level security;
alter table public.passkey_challenges enable row level security;

-- 会社は自社勤務員のパスキーを閲覧のみ（失効は RPC 経由）。チャレンジはポリシーなし＝直接アクセス不可
drop policy if exists staff_passkeys_company_read on public.staff_passkeys;
create policy staff_passkeys_company_read on public.staff_passkeys for select
  using (company_id = public.app_company_id() or public.app_is_platform());
grant select on public.staff_passkeys to authenticated;

-- ── 3) 報告の受付時に生体認証を判定（jyoban_submit_report の内容は変えない）───────
create or replace function public.jyoban_reports_bio_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_mode text;
begin
  new.bio_verified := new.device_id is not null and exists (
    select 1 from public.jyoban_devices d
     where d.id = new.device_id and d.revoked_at is null
       and d.bio_verified_at is not null
       and d.bio_verified_at >= now() - interval '5 minutes');
  select s.biometric_mode into v_mode from public.sites s where s.id = new.site_id;
  if coalesce(v_mode, 'off') = 'required' and not new.bio_verified and not coalesce(new.via_shared, false) then
    raise exception 'BIO_REQUIRED: 顔・指紋で本人確認してから送信してください' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_jyoban_reports_bio on public.jyoban_reports;
create trigger trg_jyoban_reports_bio before insert on public.jyoban_reports
  for each row execute function public.jyoban_reports_bio_check();

-- ── 4) 勤務員アプリ: 現場の生体認証設定を知る（QRトークンで現場を特定）────────
create or replace function public.jyoban_site_biometric(p_token text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(s.biometric_mode, 'off') from public.sites s
   where s.report_token = p_token and s.report_token is not null and coalesce(s.is_active, true);
$$;
grant execute on function public.jyoban_site_biometric(text) to anon, authenticated;

-- ── 5) APIゲートウェイ専用 RPC（service_role のみ）─────────────────────
-- 5-1) 端末シークレット → 勤務員と登録済みパスキー
--   端末シークレットは256bitの乱数で全社で一意（ハッシュに一意制約）。会社コードなしで端末を特定できる。
create or replace function public.passkey_device_staff(p_device_secret text)
returns table(device_id uuid, staff_id uuid, company_id uuid, staff_no text, staff_name text, dept text,
              credentials jsonb)
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_dev public.jyoban_devices; v_staff public.staff;
begin
  if p_device_secret is null or length(p_device_secret) < 32 then return; end if;
  select d.* into v_dev from public.jyoban_devices d
   where d.secret_hash = encode(extensions.digest(p_device_secret, 'sha256'), 'hex') and d.revoked_at is null;
  if v_dev.id is null then return; end if;
  select st.* into v_staff from public.staff st
   where st.id = v_dev.staff_id and st.company_id = v_dev.company_id and coalesce(st.is_active, true);
  if v_staff.id is null then return; end if;
  if not exists (select 1 from public.companies c where c.id = v_dev.company_id and c.is_active) then return; end if;
  device_id := v_dev.id; staff_id := v_staff.id; company_id := v_dev.company_id;
  staff_no := v_staff.staff_no; staff_name := v_staff.name; dept := v_staff.dept;
  select coalesce(jsonb_agg(jsonb_build_object('id', k.credential_id, 'transports', to_jsonb(k.transports))
                            order by k.created_at), '[]'::jsonb)
    into credentials
    from public.staff_passkeys k where k.staff_id = v_staff.id and k.revoked_at is null;
  return next;
end $$;

-- 5-2) チャレンジを保存（同じ端末・用途の古いものは無効化）
create or replace function public.passkey_save_challenge(p_device_id uuid, p_purpose text, p_challenge text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.passkey_challenges set used_at = now()
   where device_id = p_device_id and purpose = p_purpose and used_at is null;
  insert into public.passkey_challenges(device_id, purpose, challenge) values (p_device_id, p_purpose, p_challenge);
  delete from public.passkey_challenges where expires_at < now() - interval '1 day';
end $$;

-- 5-3) チャレンジを取り出す（有効なものを1回だけ）
create or replace function public.passkey_take_challenge(p_device_id uuid, p_purpose text)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ch text;
begin
  select c.id, c.challenge into v_id, v_ch from public.passkey_challenges c
   where c.device_id = p_device_id and c.purpose = p_purpose and c.used_at is null and c.expires_at > now()
   order by c.expires_at desc limit 1 for update;
  if v_id is null then return null; end if;
  update public.passkey_challenges set used_at = now() where id = v_id;
  return v_ch;
end $$;

-- 5-4) パスキーを登録（同じ端末で作り直したときは古いものを失効）
create or replace function public.passkey_add(
  p_device_id uuid, p_credential_id text, p_public_key text, p_counter bigint,
  p_transports text[], p_device_label text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_dev public.jyoban_devices; v_id uuid;
begin
  select * into v_dev from public.jyoban_devices where id = p_device_id and revoked_at is null;
  if v_dev.id is null then raise exception '端末が見つかりません'; end if;
  update public.staff_passkeys set revoked_at = now()
   where device_id = p_device_id and staff_id = v_dev.staff_id and revoked_at is null;
  insert into public.staff_passkeys(company_id, staff_id, device_id, credential_id, public_key, counter, transports, device_label)
    values (v_dev.company_id, v_dev.staff_id, p_device_id, p_credential_id, p_public_key, coalesce(p_counter, 0),
            coalesce(p_transports, '{}'), left(p_device_label, 300))
  returning id into v_id;
  update public.jyoban_devices set bio_verified_at = now(), last_seen_at = now() where id = p_device_id;
  return v_id;
end $$;

-- 5-5) 検証に使うパスキー（その端末の勤務員のもの・失効していないもの）
create or replace function public.passkey_get(p_device_id uuid, p_credential_id text)
returns table(id uuid, public_key text, counter bigint, transports text[])
language sql stable security definer set search_path = public as $$
  select k.id, k.public_key, k.counter, k.transports
    from public.staff_passkeys k join public.jyoban_devices d on d.staff_id = k.staff_id
   where d.id = p_device_id and d.revoked_at is null
     and k.credential_id = p_credential_id and k.revoked_at is null;
$$;

-- 5-6) 本人確認に成功した: 認証回数を更新し、端末に確認時刻を記録
create or replace function public.passkey_mark_verified(p_device_id uuid, p_passkey_id uuid, p_counter bigint)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_at timestamptz := now();
begin
  update public.staff_passkeys set counter = greatest(counter, coalesce(p_counter, 0)), last_used_at = v_at
   where id = p_passkey_id and revoked_at is null;
  update public.jyoban_devices set bio_verified_at = v_at, last_seen_at = v_at where id = p_device_id;
  return v_at;
end $$;

revoke all on function public.passkey_device_staff(text)                                from public, anon, authenticated;
revoke all on function public.passkey_save_challenge(uuid, text, text)                  from public, anon, authenticated;
revoke all on function public.passkey_take_challenge(uuid, text)                        from public, anon, authenticated;
revoke all on function public.passkey_add(uuid, text, text, bigint, text[], text)       from public, anon, authenticated;
revoke all on function public.passkey_get(uuid, text)                                   from public, anon, authenticated;
revoke all on function public.passkey_mark_verified(uuid, uuid, bigint)                 from public, anon, authenticated;
grant execute on function public.passkey_device_staff(text)                          to service_role;
grant execute on function public.passkey_save_challenge(uuid, text, text)            to service_role;
grant execute on function public.passkey_take_challenge(uuid, text)                  to service_role;
grant execute on function public.passkey_add(uuid, text, text, bigint, text[], text) to service_role;
grant execute on function public.passkey_get(uuid, text)                             to service_role;
grant execute on function public.passkey_mark_verified(uuid, uuid, bigint)           to service_role;

-- ── 6) 会社コンソール: 現場の設定・パスキーの失効 ──────────────────────
create or replace function public.company_set_site_biometric(p_site_id uuid, p_mode text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.jyoban_site_in_my_company(p_site_id) then raise exception '対象現場が自社ではありません'; end if;
  if p_mode not in ('off', 'optional', 'required') then raise exception '設定値が不正です'; end if;
  update public.sites set biometric_mode = p_mode where id = p_site_id;
end $$;

create or replace function public.company_revoke_staff_passkeys(p_staff_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not exists (select 1 from public.staff s where s.id = p_staff_id
                  and (s.company_id = public.app_company_id() or public.app_is_platform())) then
    raise exception '対象の勤務員が自社ではありません';
  end if;
  update public.staff_passkeys set revoked_at = now() where staff_id = p_staff_id and revoked_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function public.company_set_site_biometric(uuid, text)  to authenticated;
grant execute on function public.company_revoke_staff_passkeys(uuid)     to authenticated;

-- 6-3) 会社コンソールの現場一覧に生体認証の設定を足す（戻り値の型が変わるため作り直す）
drop function if exists public.company_list_jyoban_sites();
create or replace function public.company_list_jyoban_sites()
returns table(site_id uuid, name text, code text, dept text, is_active boolean,
              report_token text, report_token_issued_at timestamptz,
              shared_device_enabled boolean, slot_count int, biometric_mode text)
language plpgsql stable security definer set search_path = public as $$
declare v_company uuid;
begin
  v_company := public.app_company_id();
  if v_company is null then raise exception '権限がありません'; end if;
  return query
    select s.id, s.name, s.code, s.dept, coalesce(s.is_active, true),
           s.report_token, s.report_token_issued_at, coalesce(s.shared_device_enabled, false),
           (select count(*)::int from public.jyoban_slots j where j.site_id = s.id and j.is_active),
           coalesce(s.biometric_mode, 'off')
      from public.sites s
     where s.company_id = v_company
     order by s.name;
end $$;
revoke all on function public.company_list_jyoban_sites() from public, anon;
grant execute on function public.company_list_jyoban_sites() to authenticated;
