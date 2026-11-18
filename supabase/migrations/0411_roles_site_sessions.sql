-- 0411_roles_site_sessions.sql — ロール（本社PC・教育センター等）と、ログインなしで呼べた処理の締め直し
--
-- A) ロール
--    会社のメールアカウントのロールを 5種に広げる:
--      company_admin(管理者) / company_manager(支店・権限者) / hq_operator(本社PC) / education_center(教育センター) / platform_admin
--    ・支店・権限者は担当現場（app_profile_sites）を持てる。担当がなければ会社の全現場（従来どおり）。
--    ・上番報告の設定（勤務枠・QR・共用端末・配置・通知先）を変えられるのは 管理者・支店・権限者・運営 だけ。
--      本社PC・教育センターは見るだけ（jyoban_site_in_my_company / jyoban_slot_in_my_company を権限込みに置き換え）。
--    ・アカウントと権限の管理（一覧・追加・変更・解除）は管理者だけ。変更は app_role_audit に記録する。
--
-- B) 現場PC（/s）のセッション
--    これまで現場の処理（勤務員一覧＝氏名・生年月日・PIN、PINリセット、勤務員登録、有給の承認、シフト保存 等）は
--    会社コード＋施設コードだけで anon から呼べた。現場PINで開いたセッション（12時間・使うたびに延長）を必須にする。
--    ・app_site_open_session: 現場PINの照合（15分で10回失敗すると一時ロック）→ セッショントークンを返す
--    ・sitepc_*: 新しい現場の処理（トークンで現場を特定。対象はその現場の勤務員・申請だけ）
--    ・旧関数（site_* / save_shift / load_shift / resolve_site / app_site_login）は anon・authenticated から実行権を外す
--
-- C) 勤務員アプリ（/app）
--    有給申請・申請履歴・シフト希望は、スタッフNoだけで誰の分でも出せた。本人登録した端末（端末シークレット）を必須にし、
--    スタッフNo・氏名はサーバー側で決める（worker_*）。
--    staff_login はPINの総当たり対策（15分で5回失敗すると一時ロック）を入れ、失敗時は例外ではなく0件を返す。
--    staff_change_pin も同じロックを入れ、失敗内容を戻り値（text）で返す。
--
-- 安全・冪等: 表・列の削除なし。既存表への追加列なし（新しい表のみ）。
--   CHECK制約は「許す値を広げる」差し替えのみ（compat: widen-check）。戻り値を変える関数は DROP→CREATE。
-- 依存: 0400〜0409

create extension if not exists pgcrypto with schema extensions;

-- ═════════════════════════════════════════════════════════════════════
-- A) ロール
-- ═════════════════════════════════════════════════════════════════════
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.app_profiles'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%role%' and conname <> 'app_profiles_role_chk_v2'
  loop
    execute format('alter table public.app_profiles drop constraint %I', c.conname); /* compat: widen-check */
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'app_profiles_role_chk_v2') then
    alter table public.app_profiles add constraint app_profiles_role_chk_v2
      check (role in ('company_admin', 'company_manager', 'hq_operator', 'education_center', 'platform_admin'));
  end if;
end $$;

-- 自分のロール（ログイン中の会社アカウント）
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select p.role from public.app_profiles p where p.user_id = auth.uid();
$$;

-- 支店・権限者の担当現場
create table if not exists public.app_profile_sites (
  user_id    uuid not null,
  site_id    uuid not null references public.sites(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  created_at timestamptz not null default now(),
  primary key (user_id, site_id)
);
alter table public.app_profile_sites enable row level security;
drop policy if exists app_profile_sites_read on public.app_profile_sites;
create policy app_profile_sites_read on public.app_profile_sites for select
  using (user_id = auth.uid() or company_id = public.app_company_id() or public.app_is_platform());
grant select on public.app_profile_sites to authenticated;

-- 権限の変更記録
create table if not exists public.app_role_audit (
  id         bigint generated always as identity primary key,
  company_id uuid,
  actor      uuid,
  target     uuid,
  action     text not null,
  detail     jsonb not null default '{}'::jsonb,
  at         timestamptz not null default now()
);
alter table public.app_role_audit enable row level security;
drop policy if exists app_role_audit_read on public.app_role_audit;
create policy app_role_audit_read on public.app_role_audit for select
  using ((company_id = public.app_company_id() and public.app_role() = 'company_admin') or public.app_is_platform());

grant select on public.app_role_audit to authenticated;

-- その現場の設定を変えられるか（管理者=自社全現場 / 支店・権限者=担当現場（担当なしなら自社全現場）/ 運営）
create or replace function public.app_can_manage_site(p_site_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_is_platform() or exists (
    select 1 from public.app_profiles p join public.sites s on s.id = p_site_id and s.company_id = p.company_id
     where p.user_id = auth.uid()
       and (p.role = 'company_admin'
            or (p.role = 'company_manager'
                and (not exists (select 1 from public.app_profile_sites a where a.user_id = p.user_id)
                     or exists (select 1 from public.app_profile_sites a where a.user_id = p.user_id and a.site_id = s.id)))));
$$;

-- 上番報告の設定系（勤務枠・QR・共用端末・配置・電話番号）の権限確認を、ロール込みに置き換える
create or replace function public.jyoban_site_in_my_company(p_site_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_can_manage_site(p_site_id);
$$;
create or replace function public.jyoban_slot_in_my_company(p_slot_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.jyoban_slots j where j.id = p_slot_id and public.app_can_manage_site(j.site_id));
$$;

-- 勤務枠の削除・通知先の変更も、設定を変えられる人だけ（見るのは会社の全員）
drop policy if exists jyoban_slots_delete_guard on public.jyoban_slots;
create policy jyoban_slots_delete_guard on public.jyoban_slots as restrictive for delete
  using (public.app_can_manage_site(site_id));
drop policy if exists jyoban_notify_settings_write_guard_i on public.jyoban_notify_settings;
drop policy if exists jyoban_notify_settings_write_guard_u on public.jyoban_notify_settings;
drop policy if exists jyoban_notify_settings_write_guard_d on public.jyoban_notify_settings;
create policy jyoban_notify_settings_write_guard_i on public.jyoban_notify_settings as restrictive for insert
  with check (public.app_is_platform() or public.app_role() in ('company_admin', 'company_manager'));
create policy jyoban_notify_settings_write_guard_u on public.jyoban_notify_settings as restrictive for update
  using (public.app_is_platform() or public.app_role() in ('company_admin', 'company_manager'));
create policy jyoban_notify_settings_write_guard_d on public.jyoban_notify_settings as restrictive for delete
  using (public.app_is_platform() or public.app_role() in ('company_admin', 'company_manager'));

-- ── アカウントと権限（管理者のみ）──────────────────────────────────
create or replace function public.app_require_admin() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_company uuid;
begin
  select p.company_id into v_company from public.app_profiles p
   where p.user_id = auth.uid() and p.role = 'company_admin';
  if v_company is null then raise exception 'アカウントと権限を変えられるのは管理者だけです'; end if;
  return v_company;
end $$;

create or replace function public.company_list_members()
returns table(user_id uuid, email text, role text, site_ids uuid[], is_me boolean)
language plpgsql stable security definer set search_path = public, auth as $$
declare v_company uuid := public.app_require_admin();
begin
  return query
    select p.user_id, u.email::text, p.role,
           coalesce(array(select a.site_id from public.app_profile_sites a where a.user_id = p.user_id order by a.site_id), '{}'),
           p.user_id = auth.uid()
      from public.app_profiles p left join auth.users u on u.id = p.user_id
     where p.company_id = v_company and p.role <> 'platform_admin'
     order by u.email;
end $$;

create or replace function public.app_check_member_input(p_company uuid, p_role text, p_site_ids uuid[])
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_role not in ('company_admin', 'company_manager', 'hq_operator', 'education_center') then
    raise exception 'このロールは割り当てられません';
  end if;
  if p_site_ids is not null and exists (
       select 1 from unnest(p_site_ids) x(id)
        where not exists (select 1 from public.sites s where s.id = x.id and s.company_id = p_company)) then
    raise exception '担当現場に自社以外の現場が含まれています';
  end if;
end $$;

create or replace function public.app_set_member_sites(p_company uuid, p_user uuid, p_role text, p_site_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  -- 担当現場を持つのは支店・権限者だけ。他のロールに変えたら担当は外す
  if p_role <> 'company_manager' then
    delete from public.app_profile_sites where user_id = p_user;
  elsif p_site_ids is not null then
    delete from public.app_profile_sites where user_id = p_user and not (site_id = any(p_site_ids));
    insert into public.app_profile_sites(user_id, site_id, company_id)
      select p_user, x.id, p_company from unnest(p_site_ids) x(id) on conflict do nothing;
  end if;
end $$;

-- 既にある Auth ユーザー（Authentication で招待済み）を自社のメンバーにする
create or replace function public.company_add_member(p_email text, p_role text, p_site_ids uuid[] default null)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare v_company uuid := public.app_require_admin(); v_user uuid; v_other uuid;
begin
  perform public.app_check_member_input(v_company, p_role, p_site_ids);
  select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_user is null then
    raise exception 'このメールのアカウントがありません。先に Supabase の Authentication で招待してください';
  end if;
  select p.company_id into v_other from public.app_profiles p where p.user_id = v_user;
  if found and v_other is distinct from v_company then raise exception 'このアカウントは他の会社に属しています'; end if;
  if found then raise exception 'このアカウントはすでに自社のメンバーです。ロールの変更を使ってください'; end if;
  insert into public.app_profiles(user_id, role, company_id) values (v_user, p_role, v_company);
  perform public.app_set_member_sites(v_company, v_user, p_role, p_site_ids);
  insert into public.app_role_audit(company_id, actor, target, action, detail)
    values (v_company, auth.uid(), v_user, 'add', jsonb_build_object('role', p_role, 'sites', p_site_ids));
  return v_user;
end $$;

create or replace function public.company_set_member_role(p_user_id uuid, p_role text, p_site_ids uuid[] default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_company uuid := public.app_require_admin(); v_old text;
begin
  perform public.app_check_member_input(v_company, p_role, p_site_ids);
  select p.role into v_old from public.app_profiles p where p.user_id = p_user_id and p.company_id = v_company;
  if v_old is null or v_old = 'platform_admin' then raise exception '対象のメンバーが見つかりません'; end if;
  if p_user_id = auth.uid() and p_role <> 'company_admin' then
    raise exception '自分のロールは変えられません（管理者がいなくなるのを防ぐため）';
  end if;
  update public.app_profiles set role = p_role where user_id = p_user_id;
  perform public.app_set_member_sites(v_company, p_user_id, p_role, p_site_ids);
  insert into public.app_role_audit(company_id, actor, target, action, detail)
    values (v_company, auth.uid(), p_user_id, 'set_role', jsonb_build_object('from', v_old, 'to', p_role, 'sites', p_site_ids));
end $$;

create or replace function public.company_remove_member(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_company uuid := public.app_require_admin(); v_old text;
begin
  if p_user_id = auth.uid() then raise exception '自分は外せません'; end if;
  select p.role into v_old from public.app_profiles p where p.user_id = p_user_id and p.company_id = v_company;
  if v_old is null or v_old = 'platform_admin' then raise exception '対象のメンバーが見つかりません'; end if;
  delete from public.app_profile_sites where user_id = p_user_id;
  delete from public.app_profiles where user_id = p_user_id;
  insert into public.app_role_audit(company_id, actor, target, action, detail)
    values (v_company, auth.uid(), p_user_id, 'remove', jsonb_build_object('role', v_old));
end $$;

revoke all on function public.app_require_admin()                                from public, anon, authenticated;
revoke all on function public.app_check_member_input(uuid, text, uuid[])           from public, anon, authenticated;
revoke all on function public.app_set_member_sites(uuid, uuid, text, uuid[])       from public, anon, authenticated;
revoke all on function public.company_list_members()                              from public, anon;
revoke all on function public.company_add_member(text, text, uuid[])              from public, anon;
revoke all on function public.company_set_member_role(uuid, text, uuid[])         from public, anon;
revoke all on function public.company_remove_member(uuid)                         from public, anon;
grant execute on function public.app_role()                                       to authenticated;
grant execute on function public.app_can_manage_site(uuid)                        to authenticated;
grant execute on function public.company_list_members()                           to authenticated;
grant execute on function public.company_add_member(text, text, uuid[])           to authenticated;
grant execute on function public.company_set_member_role(uuid, text, uuid[])      to authenticated;
grant execute on function public.company_remove_member(uuid)                      to authenticated;

-- ═════════════════════════════════════════════════════════════════════
-- B) 現場PC（/s）のセッション
-- ═════════════════════════════════════════════════════════════════════
create table if not exists public.app_site_sessions (
  token_hash   text primary key,                   -- sha256(トークン)。トークンそのものは保存しない
  company_id   uuid not null references public.companies(id),
  site_id      uuid not null references public.sites(id) on delete cascade,
  label        text check (label is null or length(label) <= 200),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists idx_app_site_sessions_site on public.app_site_sessions(site_id);
create table if not exists public.app_site_login_attempts (
  id           bigint generated always as identity primary key,
  company_code text not null,
  site_code    text not null,
  attempted_at timestamptz not null default now()
);
create index if not exists idx_app_site_login_attempts on public.app_site_login_attempts(company_code, site_code, attempted_at);
alter table public.app_site_sessions       enable row level security;   -- ポリシーなし＝関数経由のみ
alter table public.app_site_login_attempts enable row level security;

-- 現場PINでセッションを開く。失敗は0件（例外にすると失敗の記録が消えるため）、ロック中は例外。
create or replace function public.app_site_open_session(p_company_code text, p_site_code text, p_pin text, p_label text default null)
returns table(session_token text, site_id uuid, company_id uuid, site_name text, expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare v_cc text := upper(btrim(coalesce(p_company_code, ''))); v_sc text := upper(btrim(coalesce(p_site_code, '')));
        v_fail int; c public.app_site_credentials; v_token text;
begin
  select count(*) into v_fail from public.app_site_login_attempts a
   where a.company_code = v_cc and a.site_code = v_sc and a.attempted_at > now() - interval '15 minutes';
  if v_fail >= 10 then
    raise exception '現場PINの入力ミスが続いたため一時的にロックしています。15分後にお試しください';
  end if;
  select * into c from public.app_site_credentials x
   where x.company_code = v_cc and x.site_code = v_sc and x.pin_hash = extensions.crypt(coalesce(p_pin, ''), x.pin_hash);
  if c.site_id is null then
    insert into public.app_site_login_attempts(company_code, site_code) values (v_cc, v_sc);
    return;
  end if;
  delete from public.app_site_login_attempts a where a.company_code = v_cc and a.site_code = v_sc;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.app_site_sessions(token_hash, company_id, site_id, label, expires_at)
    values (encode(extensions.digest(v_token, 'sha256'), 'hex'), c.company_id, c.site_id, left(p_label, 200), now() + interval '12 hours');
  delete from public.app_site_sessions s where s.expires_at < now() - interval '7 days';
  session_token := v_token; site_id := c.site_id; company_id := c.company_id; site_name := c.site_name;
  expires_at := now() + interval '12 hours';
  return next;
end $$;

create or replace function public.app_site_close_session(p_session text) returns void
language sql security definer set search_path = public, extensions as $$
  update public.app_site_sessions set revoked_at = now()
   where token_hash = encode(extensions.digest(coalesce(p_session, ''), 'sha256'), 'hex') and revoked_at is null;
$$;

-- セッション → 会社・現場（内部用。使うたびに12時間延長）
create or replace function public.sitepc_resolve(p_session text)
returns table(company_id uuid, site_id uuid)
language plpgsql security definer set search_path = public, extensions as $$
declare s public.app_site_sessions;
begin
  if p_session is null or length(p_session) < 32 then raise exception 'SESSION: 現場のログインが切れました。もう一度ログインしてください'; end if;
  select * into s from public.app_site_sessions x
   where x.token_hash = encode(extensions.digest(p_session, 'sha256'), 'hex')
     and x.revoked_at is null and x.expires_at > now();
  if s.site_id is null then raise exception 'SESSION: 現場のログインが切れました。もう一度ログインしてください'; end if;
  update public.app_site_sessions set last_used_at = now(), expires_at = greatest(expires_at, now() + interval '12 hours')
   where token_hash = s.token_hash;
  company_id := s.company_id; site_id := s.site_id;
  return next;
end $$;

-- 現場の処理（セッション必須。対象はその現場の勤務員・申請だけ）
create or replace function public.sitepc_list_staff(p_session text)
returns table(staff_no text, name text, dob date, dept text, role text,
              pin_current text, pin_must_change boolean, is_active boolean)
language plpgsql security definer set search_path = public as $$
declare v_s uuid;
begin
  select r.site_id into v_s from public.sitepc_resolve(p_session) r;
  return query
    select s.staff_no, s.name, s.dob, s.dept, s.role, s.pin_current,
           coalesce(s.pin_must_change, false), coalesce(s.is_active, true)
      from public.staff s join public.staff_sites ss on ss.staff_id = s.id
     where ss.site_id = v_s
     order by s.staff_no;
end $$;

create or replace function public.sitepc_register_staff(
  p_session text, p_staff_no text, p_name text, p_dob date, p_dept text, p_role text, p_pin text
) returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_c uuid; v_s uuid; v_staff uuid; v_pin text;
begin
  select r.company_id, r.site_id into v_c, v_s from public.sitepc_resolve(p_session) r;
  if coalesce(btrim(p_staff_no), '') = '' or coalesce(btrim(p_name), '') = '' then raise exception 'スタッフNoと氏名は必須です'; end if;
  select id into v_staff from public.staff where company_id = v_c and staff_no = p_staff_no;
  if v_staff is not null then
    -- 他の現場の勤務員は上書きしない（自分の現場に配置されている人だけ更新できる）
    if not exists (select 1 from public.staff_sites ss where ss.staff_id = v_staff and ss.site_id = v_s) then
      raise exception 'このスタッフNoは他の現場の勤務員です。本社に配置を依頼してください';
    end if;
    update public.staff set name = p_name, dob = p_dob, dept = coalesce(p_dept, dept), role = coalesce(p_role, role), is_active = true
     where id = v_staff;
  else
    v_pin := coalesce(nullif(p_pin, ''), public.pin_from_dob(p_dob));
    insert into public.staff(company_id, staff_no, name, dob, dept, role, pin_hash, pin_current, pin_must_change, is_active, site_id)
      values (v_c, p_staff_no, p_name, p_dob, p_dept, p_role,
              extensions.crypt(v_pin, extensions.gen_salt('bf')), v_pin, true, true, v_s)
      returning id into v_staff;
    insert into public.staff_sites(staff_id, site_id) values (v_staff, v_s) on conflict do nothing;
  end if;
  return v_staff;
end $$;

create or replace function public.sitepc_set_staff_active(p_session text, p_staff_no text, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_c uuid; v_s uuid;
begin
  select r.company_id, r.site_id into v_c, v_s from public.sitepc_resolve(p_session) r;
  update public.staff s set is_active = p_active
   where s.company_id = v_c and s.staff_no = p_staff_no
     and exists (select 1 from public.staff_sites ss where ss.staff_id = s.id and ss.site_id = v_s);
  if not found then raise exception '対象の勤務員が見つかりません'; end if;
end $$;

create or replace function public.sitepc_reset_pin(p_session text, p_staff_no text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_c uuid; v_s uuid; v_id uuid; v_dob date; v_pin text;
begin
  select r.company_id, r.site_id into v_c, v_s from public.sitepc_resolve(p_session) r;
  select s.id, s.dob into v_id, v_dob from public.staff s
   where s.company_id = v_c and s.staff_no = p_staff_no
     and exists (select 1 from public.staff_sites ss where ss.staff_id = s.id and ss.site_id = v_s);
  if v_id is null or v_dob is null then raise exception '対象の勤務員が見つかりません'; end if;
  v_pin := public.pin_from_dob(v_dob);
  update public.staff set pin_hash = extensions.crypt(v_pin, extensions.gen_salt('bf')), pin_current = v_pin, pin_must_change = true
   where id = v_id;
  return v_pin;
end $$;

create or replace function public.sitepc_list_leave(p_session text)
returns setof public.leave_requests language plpgsql security definer set search_path = public as $$
declare v_s uuid;
begin
  select r.site_id into v_s from public.sitepc_resolve(p_session) r;
  return query select l.* from public.leave_requests l where l.site_id = v_s order by l.submitted_at desc;
end $$;

create or replace function public.sitepc_approve_leave(p_session text, p_id uuid, p_approver jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_s uuid;
begin
  select r.site_id into v_s from public.sitepc_resolve(p_session) r;
  update public.leave_requests set status = '現場承認', site_approver = p_approver
   where id = p_id and site_id = v_s and status = '申請中';
  if not found then raise exception '対象の申請が見つかりません'; end if;
end $$;

create or replace function public.sitepc_reject_leave(p_session text, p_id uuid, p_by text)
returns void language plpgsql security definer set search_path = public as $$
declare v_s uuid;
begin
  select r.site_id into v_s from public.sitepc_resolve(p_session) r;
  update public.leave_requests set status = '却下', rejected_by = p_by where id = p_id and site_id = v_s;
  if not found then raise exception '対象の申請が見つかりません'; end if;
end $$;

create or replace function public.sitepc_list_hopes(p_session text, p_ym text)
returns setof public.shift_hopes language plpgsql security definer set search_path = public as $$
declare v_s uuid;
begin
  select r.site_id into v_s from public.sitepc_resolve(p_session) r;
  return query select h.* from public.shift_hopes h where h.site_id = v_s and h.ym = p_ym;
end $$;

create or replace function public.sitepc_save_shift(p_session text, p_ym text, p_staff jsonb, p_grid jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_c uuid; v_s uuid;
begin
  select r.company_id, r.site_id into v_c, v_s from public.sitepc_resolve(p_session) r;
  insert into public.shift_snapshots(company_id, site_id, ym, staff, grid, saved_at)
    values (v_c, v_s, p_ym, p_staff, p_grid, current_date)
  on conflict (site_id, ym) do update set staff = excluded.staff, grid = excluded.grid, saved_at = excluded.saved_at;
end $$;

create or replace function public.sitepc_load_shift(p_session text, p_ym text)
returns setof public.shift_snapshots language plpgsql security definer set search_path = public as $$
declare v_s uuid;
begin
  select r.site_id into v_s from public.sitepc_resolve(p_session) r;
  return query select s.* from public.shift_snapshots s where s.site_id = v_s and s.ym = p_ym;
end $$;

revoke all on function public.sitepc_resolve(text) from public, anon, authenticated;
grant execute on function public.app_site_open_session(text, text, text, text)            to anon, authenticated;
grant execute on function public.app_site_close_session(text)                             to anon, authenticated;
grant execute on function public.sitepc_list_staff(text)                                  to anon, authenticated;
grant execute on function public.sitepc_register_staff(text, text, text, date, text, text, text) to anon, authenticated;
grant execute on function public.sitepc_set_staff_active(text, text, boolean)             to anon, authenticated;
grant execute on function public.sitepc_reset_pin(text, text)                             to anon, authenticated;
grant execute on function public.sitepc_list_leave(text)                                  to anon, authenticated;
grant execute on function public.sitepc_approve_leave(text, uuid, jsonb)                  to anon, authenticated;
grant execute on function public.sitepc_reject_leave(text, uuid, text)                    to anon, authenticated;
grant execute on function public.sitepc_list_hopes(text, text)                            to anon, authenticated;
grant execute on function public.sitepc_save_shift(text, text, jsonb, jsonb)              to anon, authenticated;
grant execute on function public.sitepc_load_shift(text, text)                            to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════
-- C) 勤務員アプリ（/app）: 本人登録した端末から
-- ═════════════════════════════════════════════════════════════════════
-- 端末シークレット → 勤務員（失効していない端末・在籍中のみ）。内部用
create or replace function public.worker_by_device(p_device_secret text)
returns table(staff_id uuid, company_id uuid, staff_no text, staff_name text, dept text, site_id uuid)
language plpgsql security definer set search_path = public, extensions as $$
declare d public.jyoban_devices; s public.staff;
begin
  if p_device_secret is null or length(p_device_secret) < 32 then raise exception 'DEVICE: この端末は本人登録されていません。もう一度ログインしてください'; end if;
  select * into d from public.jyoban_devices x
   where x.secret_hash = encode(extensions.digest(p_device_secret, 'sha256'), 'hex') and x.revoked_at is null;
  select * into s from public.staff x where x.id = d.staff_id and x.company_id = d.company_id and coalesce(x.is_active, true);
  if s.id is null then raise exception 'DEVICE: この端末は本人登録されていません。もう一度ログインしてください'; end if;
  update public.jyoban_devices set last_seen_at = now() where id = d.id;
  staff_id := s.id; company_id := s.company_id; staff_no := s.staff_no; staff_name := s.name; dept := s.dept;
  site_id := coalesce(s.site_id, (select ss.site_id from public.staff_sites ss where ss.staff_id = s.id limit 1));
  return next;
end $$;

-- 申請先の現場: 指定があり本人がその現場に配置されていればそこ、なければ本人の主な現場
create or replace function public.worker_pick_site(p_staff uuid, p_company uuid, p_default uuid, p_site_code text)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.id from public.sites s join public.staff_sites ss on ss.site_id = s.id and ss.staff_id = p_staff
      where s.company_id = p_company and p_site_code is not null and s.code = p_site_code),
    p_default);
$$;

create or replace function public.worker_submit_leave(
  p_device_secret text, p_from date, p_to date, p_days int, p_reason text, p_site_code text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare w record; v_site uuid; v_id uuid;
begin
  select * into w from public.worker_by_device(p_device_secret);
  v_site := public.worker_pick_site(w.staff_id, w.company_id, w.site_id, p_site_code);
  if v_site is null then raise exception '配置されている現場がありません。本社に連絡してください'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception '日付が正しくありません'; end if;
  insert into public.leave_requests(company_id, site_id, staff_no, staff_name, dept, date_from, date_to, days, reason, status, submitted_at)
    values (w.company_id, v_site, w.staff_no, w.staff_name, w.dept, p_from, p_to, p_days, p_reason, '申請中', current_date)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.worker_list_leave(p_device_secret text)
returns setof public.leave_requests language plpgsql security definer set search_path = public as $$
declare w record;
begin
  select * into w from public.worker_by_device(p_device_secret);
  return query select l.* from public.leave_requests l
                where l.company_id = w.company_id and l.staff_no = w.staff_no order by l.submitted_at desc;
end $$;

create or replace function public.worker_submit_hope(
  p_device_secret text, p_ym text, p_hopes jsonb, p_note text, p_site_code text default null
) returns void language plpgsql security definer set search_path = public as $$
declare w record; v_site uuid;
begin
  select * into w from public.worker_by_device(p_device_secret);
  v_site := public.worker_pick_site(w.staff_id, w.company_id, w.site_id, p_site_code);
  if v_site is null then raise exception '配置されている現場がありません。本社に連絡してください'; end if;
  insert into public.shift_hopes(company_id, site_id, staff_no, staff_name, ym, hopes, note, submitted_at)
    values (w.company_id, v_site, w.staff_no, w.staff_name, p_ym, p_hopes, p_note, current_date)
  on conflict (site_id, staff_no, ym) do update
    set hopes = excluded.hopes, note = excluded.note, staff_name = excluded.staff_name, submitted_at = excluded.submitted_at;
end $$;

revoke all on function public.worker_by_device(text)                   from public, anon, authenticated;
revoke all on function public.worker_pick_site(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.worker_submit_leave(text, date, date, int, text, text) to anon, authenticated;
grant execute on function public.worker_list_leave(text)                                to anon, authenticated;
grant execute on function public.worker_submit_hope(text, text, jsonb, text, text)      to anon, authenticated;

-- ── 勤務員のPIN: 総当たり対策（15分で5回失敗すると一時ロック。jyoban_verify_pin と同じ記録を使う）──
create or replace function public.staff_login(p_company_code text, p_staff_no text, p_pin text)
returns table(staff_id uuid, name text, dept text, site_ids uuid[], must_change boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare v_company uuid; v record; v_staff public.staff;
begin
  select id into v_company from public.companies where code = p_company_code and is_active;
  if v_company is null then return; end if;
  select * into v from public.jyoban_verify_pin(v_company, p_staff_no, p_pin);
  if v.staff_id is null then return; end if;   -- 失敗は0件（記録を残すため例外にしない）
  select * into v_staff from public.staff where id = v.staff_id;
  return query
    select v_staff.id, v_staff.name, v_staff.dept,
           coalesce(array(select ss.site_id from public.staff_sites ss where ss.staff_id = v_staff.id), '{}'),
           coalesce(v_staff.pin_must_change, false);
end $$;

drop function if exists public.staff_change_pin(text, text, text, text);
create or replace function public.staff_change_pin(
  p_company_code text, p_staff_no text, p_old_pin text, p_new_pin text
) returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_company uuid; v record;
begin
  if p_new_pin is null or p_new_pin !~ '^\d{4,8}$' then return 'PINは4〜8桁の数字です'; end if;
  select id into v_company from public.companies where code = p_company_code and is_active;
  if v_company is null then return '会社コードが不正です'; end if;
  select * into v from public.jyoban_verify_pin(v_company, p_staff_no, p_old_pin);
  if v.staff_id is null then return public.jyoban_pin_message(v.error); end if;
  update public.staff set pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf')),
         pin_current = p_new_pin, pin_must_change = false
   where id = v.staff_id;
  return null;
end $$;
grant execute on function public.staff_login(text, text, text)            to anon, authenticated;
grant execute on function public.staff_change_pin(text, text, text, text) to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════
-- D) ログインなしで呼べた旧関数の実行権を外す（中身は残す。アプリは sitepc_* / worker_* を使う）
-- ═════════════════════════════════════════════════════════════════════
revoke all on function public.resolve_site(text, text)                                     from public, anon, authenticated;
revoke all on function public.app_site_login(text, text, text)                             from public, anon, authenticated;
revoke all on function public.site_list_staff(text, text)                                  from public, anon, authenticated;
revoke all on function public.site_register_staff(text, text, text, text, date, text, text, text) from public, anon, authenticated;
revoke all on function public.site_set_staff_active(text, text, boolean)                   from public, anon, authenticated;
revoke all on function public.site_reset_pin(text, text)                                   from public, anon, authenticated;
revoke all on function public.site_list_leave(text, text)                                  from public, anon, authenticated;
revoke all on function public.site_approve_leave(text, text, uuid, jsonb)                  from public, anon, authenticated;
revoke all on function public.site_reject_leave(text, text, uuid, text)                    from public, anon, authenticated;
revoke all on function public.site_list_hopes(text, text, text)                            from public, anon, authenticated;
revoke all on function public.save_shift(text, text, text, jsonb, jsonb)                   from public, anon, authenticated;
revoke all on function public.load_shift(text, text, text)                                 from public, anon, authenticated;
revoke all on function public.submit_leave(text, text, text, text, text, date, date, int, text) from public, anon, authenticated;
revoke all on function public.staff_list_leave(text, text)                                 from public, anon, authenticated;
revoke all on function public.submit_hope(text, text, text, text, text, jsonb, text)        from public, anon, authenticated;
-- site_staff_pins(uuid) はログイン必須だが、会社の誰でも（本社PC・教育センターも）全現場のPINを見られた。
-- 設定を変えられる人（管理者・担当の支店・権限者・運営）だけにする
create or replace function public.site_staff_pins(p_site_id uuid)
returns table(staff_no text, name text, pin_current text, must_change boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.app_can_manage_site(p_site_id) then raise exception '権限がありません'; end if;
  return query
    select s.staff_no, s.name, s.pin_current, coalesce(s.pin_must_change, false)
      from public.staff s
      join public.staff_sites ss on ss.staff_id = s.id
      join public.sites st on st.id = p_site_id and st.company_id = s.company_id
     where ss.site_id = p_site_id and s.is_active
     order by s.staff_no;
end $$;
