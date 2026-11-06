-- 0409_jyoban_calls.sql — 上番報告: 起床・下番の報告と、未報告時の自動の知らせ（起床・出発・到着コール）
-- 内容:
--   1) 勤務枠に「起床連絡」「下番連絡」の要否・期限を追加（既存列は変えない。追加列はNULL許容＝後方互換）
--   2) 報告の種類に wakeup（起床）/ offduty（下番）を追加
--   3) 勤務枠の担当者（誰に知らせるか）・隊員の電話番号・Web Push の購読先
--   4) 会社ごとの通知設定（管制メールの宛先、SMS/音声電話/アプリ通知の使用、段階ごとの待ち時間）
--   5) 通知の記録（同じ知らせを二度送らないための台帳）
--   6) RPC: 勤務員PWA（購読登録・新しい報告種別）/ 会社（担当者・電話番号）/ 通知ワーカー（service_role のみ）
-- 安全・冪等: 追加のみ（ADD COLUMN IF NOT EXISTS / CREATE IF NOT EXISTS / CREATE OR REPLACE）。
--   報告種別のCHECKだけは、名前を調べて差し替える（許す値を広げるだけ。既存データはすべて新しい制約を満たす）。
--   この1行は backwardCompat テストの例外マーカー /* compat: widen-check */ 付き。
-- 依存: 0406（jyoban_slots/reports/acks）, 0407（jyoban_site_by_token ほか）, 0400（staff, staff_sites, companies）

-- ── 1) 勤務枠: 起床・下番 ─────────────────────────────────────────
alter table public.jyoban_slots add column if not exists wakeup_required  boolean default false;
alter table public.jyoban_slots add column if not exists wakeup_due       text;
alter table public.jyoban_slots add column if not exists offduty_required boolean default false;
alter table public.jyoban_slots add column if not exists offduty_due      text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'jyoban_slots_wakeup_due_fmt') then
    alter table public.jyoban_slots add constraint jyoban_slots_wakeup_due_fmt
      check (wakeup_due is null or wakeup_due ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'jyoban_slots_offduty_due_fmt') then
    alter table public.jyoban_slots add constraint jyoban_slots_offduty_due_fmt
      check (offduty_due is null or offduty_due ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'jyoban_slots_wakeup_need_due') then
    alter table public.jyoban_slots add constraint jyoban_slots_wakeup_need_due
      check (not coalesce(wakeup_required, false) or wakeup_due is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'jyoban_slots_offduty_need_due') then
    alter table public.jyoban_slots add constraint jyoban_slots_offduty_need_due
      check (not coalesce(offduty_required, false) or offduty_due is not null);
  end if;
end $$;

-- ── 2) 報告の種類に wakeup / offduty を追加 ─────────────────────────
do $$
declare c record;
begin
  for c in
    select con.conname from pg_constraint con
     where con.conrelid = 'public.jyoban_reports'::regclass and con.contype = 'c'
       and pg_get_constraintdef(con.oid) like '%departure%' and con.conname <> 'jyoban_reports_type_v2'
  loop
    execute format('alter table public.jyoban_reports drop constraint %I', c.conname); /* compat: widen-check */
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'jyoban_reports_type_v2') then
    alter table public.jyoban_reports add constraint jyoban_reports_type_v2
      check (type in ('wakeup','departure','onduty','offduty','other'));
  end if;
end $$;

-- ── 3) 担当者・電話番号・Push購読 ───────────────────────────────────
-- 隊員の電話番号（SMS・音声電話の宛先）。国内番号は 0 始まり 10〜11桁、国際形式は +81… を許す
alter table public.staff add column if not exists phone text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'staff_phone_fmt') then
    alter table public.staff add constraint staff_phone_fmt
      check (phone is null or phone ~ '^(\+[1-9][0-9]{7,14}|0[0-9]{9,10})$');
  end if;
end $$;

-- 勤務枠の担当者（未報告のとき本人に知らせる相手）
create table if not exists public.jyoban_slot_staff (
  slot_id    uuid not null references public.jyoban_slots(id) on delete cascade,
  staff_id   uuid not null references public.staff(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  created_at timestamptz not null default now(),
  primary key (slot_id, staff_id)
);
create index if not exists idx_jyoban_slot_staff_staff on public.jyoban_slot_staff(staff_id);

-- Web Push の購読先（勤務員アプリの端末ごと）
create table if not exists public.jyoban_push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  staff_id   uuid not null references public.staff(id) on delete cascade,
  device_id  uuid references public.jyoban_devices(id) on delete cascade,
  endpoint   text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh     text not null check (length(p256dh) between 20 and 200),
  auth       text not null check (length(auth) between 8 and 100),
  created_at timestamptz not null default now(),
  failed_at  timestamptz                         -- 送信先が無効（410等）になった日時。以後は使わない
);
create index if not exists idx_jyoban_push_staff on public.jyoban_push_subscriptions(staff_id);

-- ── 4) 会社ごとの通知設定 ─────────────────────────────────────────
create table if not exists public.jyoban_notify_settings (
  company_id         uuid primary key references public.companies(id) default public.app_company_id(),
  enabled            boolean not null default true,
  email_to           text[] not null default '{}'
                     check (cardinality(email_to) <= 10),
  push_enabled       boolean not null default true,
  sms_enabled        boolean not null default false,
  voice_enabled      boolean not null default false,
  remind_after_min   int not null default 0  check (remind_after_min between 0 and 60),   -- 期限＋猶予の何分後に本人へ（アプリ通知・SMS）
  voice_after_min    int not null default 5  check (voice_after_min between 0 and 120),  -- 何分後に本人へ電話
  escalate_after_min int not null default 10 check (escalate_after_min between 0 and 180), -- 何分後に管制へメール
  updated_at         timestamptz not null default now()
);

-- ── 5) 通知の台帳（同じ知らせを二度送らない）────────────────────────
create table if not exists public.jyoban_notifications (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  slot_id     uuid not null references public.jyoban_slots(id) on delete cascade,
  work_date   date not null,
  report_type text not null check (report_type in ('wakeup','departure','onduty','offduty')),
  step        text not null check (step in ('remind','call','escalate')),
  channel     text not null check (channel in ('push','sms','voice','email')),
  staff_id    uuid references public.staff(id) on delete set null,
  status      text not null default 'sending' check (status in ('sending','sent','failed','skipped')),
  detail      text check (detail is null or length(detail) <= 500),
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists uq_jyoban_notifications_once on public.jyoban_notifications
  (slot_id, work_date, report_type, step, channel, coalesce(staff_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists idx_jyoban_notifications_board on public.jyoban_notifications(company_id, work_date);

-- ── 6) RLS ───────────────────────────────────────────────────────
alter table public.jyoban_slot_staff         enable row level security;
alter table public.jyoban_push_subscriptions enable row level security;
alter table public.jyoban_notify_settings    enable row level security;
alter table public.jyoban_notifications      enable row level security;

drop policy if exists jyoban_slot_staff_platform on public.jyoban_slot_staff;
create policy jyoban_slot_staff_platform on public.jyoban_slot_staff for all
  using (public.app_is_platform()) with check (public.app_is_platform());
drop policy if exists jyoban_slot_staff_company_read on public.jyoban_slot_staff;
create policy jyoban_slot_staff_company_read on public.jyoban_slot_staff for select
  using (company_id = public.app_company_id());

drop policy if exists jyoban_notify_settings_company on public.jyoban_notify_settings;
create policy jyoban_notify_settings_company on public.jyoban_notify_settings for all
  using (company_id = public.app_company_id())
  with check (company_id = public.app_company_id());

-- 通知の記録は会社が閲覧のみ（書込は通知ワーカー＝service_role）
drop policy if exists jyoban_notifications_company on public.jyoban_notifications;
create policy jyoban_notifications_company on public.jyoban_notifications for select
  using (company_id = public.app_company_id());
-- Push購読は RPC 経由のみ（ポリシーなし＝直接アクセス不可）

grant select, insert, update on public.jyoban_notify_settings to authenticated;
grant select on public.jyoban_notifications, public.jyoban_slot_staff to authenticated;

-- ── 7) 勤務員PWA: 報告画面の表示（起床・下番を追加）──────────────────
create or replace function public.jyoban_context(p_token text, p_device_secret text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_site public.sites; v_staff public.staff; v_now timestamp; v_slots jsonb := '[]'::jsonb; s public.jyoban_slots; v_wd date;
begin
  v_site := public.jyoban_site_by_token(p_token);
  select st.* into v_staff from public.jyoban_staff_by_device(v_site.company_id, p_device_secret) d
    join public.staff st on st.id = d.staff_id;
  v_now := public.jyoban_now_local();
  for s in select * from public.jyoban_slots j where j.site_id = v_site.id and j.is_active order by j.sort_order, j.work_start loop
    v_wd := public.jyoban_work_date(s, v_now);
    continue when v_wd is null;
    v_slots := v_slots || jsonb_build_object(
      'id', s.id, 'name', s.name, 'work_start', s.work_start, 'work_end', s.work_end,
      'wakeup_required', coalesce(s.wakeup_required, false), 'wakeup_due', s.wakeup_due,
      'departure_required', s.departure_required, 'departure_due', s.departure_due,
      'onduty_required', s.onduty_required, 'onduty_due', s.onduty_due,
      'offduty_required', coalesce(s.offduty_required, false), 'offduty_due', s.offduty_due,
      'grace_min', s.grace_min,
      'weekdays', to_jsonb(s.weekdays), 'work_date', v_wd,
      'reports', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id, 'type', r.type, 'other_kind', r.other_kind, 'eta', r.eta,
          'staff_no', r.staff_no, 'staff_name', r.staff_name, 'voided', r.voided_at is not null,
          'received_at', to_char(r.received_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD"T"HH24:MI')
        ) order by r.received_at)
          from public.jyoban_reports r
         where r.slot_id = s.id and r.work_date = v_wd and r.voided_at is null
           and ((v_staff.id is not null and r.staff_id = v_staff.id)
             or (v_staff.id is null and coalesce(v_site.shared_device_enabled, false)))
      ), '[]'::jsonb)
    );
  end loop;
  return jsonb_build_object(
    'site', jsonb_build_object('name', v_site.name, 'dept', v_site.dept, 'shared', coalesce(v_site.shared_device_enabled, false)),
    'staff', case when v_staff.id is null then null else jsonb_build_object('no', v_staff.staff_no, 'name', v_staff.name) end,
    'now', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI'),
    'slots', v_slots
  );
end $$;

-- ── 8) 勤務員PWA: 報告の送信（起床・下番を受け付ける）──────────────
create or replace function public.jyoban_submit_report(
  p_token text, p_slot_id uuid, p_type text,
  p_device_secret text default null, p_staff_no text default null, p_pin text default null,
  p_other_kind text default null, p_eta text default null, p_note text default null,
  p_client_id uuid default null, p_client_at timestamptz default null
) returns table(report_id uuid, work_date date, received_at text, duplicate boolean, error text)
language plpgsql security definer set search_path = public as $$
declare v_site public.sites; v_staff public.staff; v_dev uuid; v_slot public.jyoban_slots; v_wd date; v_id uuid; v_shared boolean := false; v_check record;
begin
  v_site := public.jyoban_site_by_token(p_token);

  if p_client_id is not null then
    select r.id, r.work_date, to_char(r.received_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD"T"HH24:MI')
      into v_id, v_wd, received_at from public.jyoban_reports r where r.client_id = p_client_id and r.site_id = v_site.id;
    if v_id is not null then report_id := v_id; work_date := v_wd; duplicate := true; error := null; return next; return; end if;
  end if;

  select d.device_id into v_dev from public.jyoban_staff_by_device(v_site.company_id, p_device_secret) d;
  select st.* into v_staff from public.jyoban_devices dv join public.staff st on st.id = dv.staff_id where dv.id = v_dev;
  if v_staff.id is null then
    if not coalesce(v_site.shared_device_enabled, false) then
      raise exception '本人登録が必要です。スタッフNoとPINで登録してください';
    end if;
    select * into v_check from public.jyoban_verify_pin(v_site.company_id, p_staff_no, p_pin);
    if v_check.error is not null then
      report_id := null; work_date := null; received_at := null; duplicate := false;
      error := public.jyoban_pin_message(v_check.error); return next; return;
    end if;
    select * into v_staff from public.staff st where st.id = v_check.staff_id;
    v_shared := true;
  end if;

  select * into v_slot from public.jyoban_slots j where j.id = p_slot_id and j.site_id = v_site.id;
  if v_slot.id is null then raise exception 'この現場の勤務枠ではありません'; end if;
  v_wd := public.jyoban_work_date(v_slot, public.jyoban_now_local());
  if v_wd is null then raise exception 'いまは「%」の報告を受け付ける時間ではありません', v_slot.name; end if;

  if p_type not in ('wakeup','departure','onduty','offduty','other') then raise exception '報告の種類が不正です'; end if;
  if p_type = 'wakeup' and not coalesce(v_slot.wakeup_required, false) then raise exception 'この勤務枠は起床連絡が不要です'; end if;
  if p_type = 'departure' and not v_slot.departure_required then raise exception 'この勤務枠は出発連絡が不要です'; end if;
  if p_type = 'onduty' and not v_slot.onduty_required then raise exception 'この勤務枠は上番連絡が不要です'; end if;
  if p_type = 'offduty' and not coalesce(v_slot.offduty_required, false) then raise exception 'この勤務枠は下番連絡が不要です'; end if;
  if p_type = 'other' then
    if p_other_kind is null or p_other_kind not in ('late','oversleep','traffic_delay','sick','absent','other') then raise exception '内容を選んでください'; end if;
    if p_other_kind in ('late','oversleep','traffic_delay') and (p_eta is null or p_eta !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
      raise exception '到着見込み時刻を入力してください';
    end if;
    if p_other_kind = 'other' and coalesce(btrim(p_note), '') = '' then raise exception '内容をメモに入力してください'; end if;
  end if;

  -- 起床・出発・上番・下番は1人・1枠・1日1回（取消すれば再報告できる）
  if p_type <> 'other' then
    select r.id, to_char(r.received_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD"T"HH24:MI') into v_id, received_at
      from public.jyoban_reports r
     where r.slot_id = v_slot.id and r.work_date = v_wd and r.type = p_type and r.staff_id = v_staff.id and r.voided_at is null
     order by r.received_at limit 1;
    if v_id is not null then report_id := v_id; work_date := v_wd; duplicate := true; error := null; return next; return; end if;
  end if;

  insert into public.jyoban_reports(company_id, site_id, slot_id, work_date, type, staff_id, staff_no, staff_name,
                                    other_kind, eta, note, client_id, client_at, device_id, via_shared)
    values (v_site.company_id, v_site.id, v_slot.id, v_wd, p_type, v_staff.id, v_staff.staff_no, v_staff.name,
            case when p_type = 'other' then p_other_kind end, case when p_type = 'other' then p_eta end,
            nullif(left(btrim(coalesce(p_note, '')), 500), ''), p_client_id, p_client_at, v_dev, v_shared)
    returning id, to_char(jyoban_reports.received_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD"T"HH24:MI') into v_id, received_at;
  report_id := v_id; work_date := v_wd; duplicate := false; error := null; return next;
end $$;

-- ── 9) 勤務員PWA: アプリ通知の購読登録（端末シークレットで本人確認）────────
create or replace function public.jyoban_save_push_subscription(
  p_device_secret text, p_endpoint text, p_p256dh text, p_auth text
) returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare v_dev public.jyoban_devices;
begin
  if p_device_secret is null or length(p_device_secret) < 32 then raise exception '本人登録が必要です'; end if;
  select d.* into v_dev from public.jyoban_devices d
   where d.secret_hash = encode(extensions.digest(p_device_secret, 'sha256'), 'hex') and d.revoked_at is null;
  if v_dev.id is null then raise exception '本人登録が必要です'; end if;
  insert into public.jyoban_push_subscriptions(company_id, staff_id, device_id, endpoint, p256dh, auth)
    values (v_dev.company_id, v_dev.staff_id, v_dev.id, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set company_id = excluded.company_id, staff_id = excluded.staff_id, device_id = excluded.device_id,
        p256dh = excluded.p256dh, auth = excluded.auth, failed_at = null;
  return true;
end $$;

-- ── 10) 会社RPC: 担当者と電話番号 ───────────────────────────────────
-- 勤務枠の担当者候補（その現場に所属する在籍中の隊員）と、担当かどうか・電話番号
create or replace function public.company_list_slot_staff(p_slot_id uuid)
returns table(staff_id uuid, staff_no text, name text, phone text, assigned boolean, has_push boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_slot public.jyoban_slots;
begin
  if not public.jyoban_slot_in_my_company(p_slot_id) then raise exception '対象の勤務枠が自社ではありません'; end if;
  select * into v_slot from public.jyoban_slots where id = p_slot_id;
  return query
    select st.id, st.staff_no, st.name, st.phone,
           exists (select 1 from public.jyoban_slot_staff a where a.slot_id = p_slot_id and a.staff_id = st.id),
           exists (select 1 from public.jyoban_push_subscriptions p where p.staff_id = st.id and p.failed_at is null)
      from public.staff st
     where st.company_id = v_slot.company_id and coalesce(st.is_active, true)
       and (st.site_id = v_slot.site_id
            or exists (select 1 from public.staff_sites ss where ss.staff_id = st.id and ss.site_id = v_slot.site_id)
            or exists (select 1 from public.jyoban_slot_staff a where a.slot_id = p_slot_id and a.staff_id = st.id))
     order by st.staff_no;
end $$;

create or replace function public.company_set_slot_staff(p_slot_id uuid, p_staff_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_slot public.jyoban_slots;
begin
  if not public.jyoban_slot_in_my_company(p_slot_id) then raise exception '対象の勤務枠が自社ではありません'; end if;
  select * into v_slot from public.jyoban_slots where id = p_slot_id;
  if exists (select 1 from unnest(coalesce(p_staff_ids, '{}')) x
              where not exists (select 1 from public.staff st where st.id = x and st.company_id = v_slot.company_id)) then
    raise exception '自社の隊員ではない人が含まれています';
  end if;
  delete from public.jyoban_slot_staff where slot_id = p_slot_id and not (staff_id = any(coalesce(p_staff_ids, '{}')));
  insert into public.jyoban_slot_staff(slot_id, staff_id, company_id)
    select p_slot_id, x, v_slot.company_id from unnest(coalesce(p_staff_ids, '{}')) x
  on conflict do nothing;
end $$;

create or replace function public.company_set_staff_phone(p_staff_id uuid, p_phone text)
returns void language plpgsql security definer set search_path = public as $$
declare v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[-\s()]', '', 'g'), '');
begin
  if public.app_company_id() is null then raise exception '権限がありません'; end if;
  if v_phone is not null and v_phone !~ '^(\+[1-9][0-9]{7,14}|0[0-9]{9,10})$' then
    raise exception '電話番号の形式が正しくありません（例: 09012345678）';
  end if;
  update public.staff set phone = v_phone where id = p_staff_id and company_id = public.app_company_id();
  if not found then raise exception '自社の隊員が見つかりません'; end if;
end $$;

-- ── 11) 通知ワーカー用RPC（service_role のみ）───────────────────────
-- いま通知の判定が必要な「勤務枠×勤務日」を、判定に必要な材料ごと返す。
--   対象: 通知が有効な会社の稼働中の勤務枠で、勤務日 d の [開始−12h, 終了＋4h] に今が入るもの
create or replace function public.jyoban_call_candidates(p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_local timestamp := (p_now at time zone 'Asia/Tokyo'); v_out jsonb := '[]'::jsonb;
        s record; v_d date; v_start int; v_end int; v_t int; o int;
begin
  for s in
    select j.*, si.name as site_name, ns.email_to, ns.push_enabled, ns.sms_enabled, ns.voice_enabled,
           ns.remind_after_min, ns.voice_after_min, ns.escalate_after_min
      from public.jyoban_slots j
      join public.sites si on si.id = j.site_id and coalesce(si.is_active, true)
      join public.companies c on c.id = j.company_id and c.is_active
      join public.jyoban_notify_settings ns on ns.company_id = j.company_id and ns.enabled
     where j.is_active
  loop
    v_start := split_part(s.work_start, ':', 1)::int * 60 + split_part(s.work_start, ':', 2)::int;
    v_end   := split_part(s.work_end,   ':', 1)::int * 60 + split_part(s.work_end,   ':', 2)::int;
    if v_end <= v_start then v_end := v_end + 1440; end if;
    foreach o in array array[-1, 0, 1] loop
      v_d := v_local::date + o;
      v_t := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int - o * 1440;
      continue when v_t < v_start - 720 or v_t > v_end + 240;
      continue when not (extract(dow from v_d)::smallint = any(s.weekdays));
      v_out := v_out || jsonb_build_object(
        'company_id', s.company_id, 'site_name', s.site_name, 'work_date', v_d, 'now_minutes', v_t,
        'slot', jsonb_build_object(
          'id', s.id, 'siteId', s.site_id, 'name', s.name, 'workStart', s.work_start, 'workEnd', s.work_end,
          'wakeupRequired', coalesce(s.wakeup_required, false), 'wakeupDue', s.wakeup_due,
          'departureRequired', s.departure_required, 'departureDue', s.departure_due,
          'ondutyRequired', s.onduty_required, 'ondutyDue', s.onduty_due,
          'offdutyRequired', coalesce(s.offduty_required, false), 'offdutyDue', s.offduty_due,
          'graceMin', s.grace_min, 'weekdays', to_jsonb(s.weekdays), 'isActive', s.is_active),
        'settings', jsonb_build_object(
          'emailTo', to_jsonb(s.email_to), 'push', s.push_enabled, 'sms', s.sms_enabled, 'voice', s.voice_enabled,
          'remindAfterMin', s.remind_after_min, 'voiceAfterMin', s.voice_after_min, 'escalateAfterMin', s.escalate_after_min),
        'acknowledged', exists (select 1 from public.jyoban_acks a where a.slot_id = s.id and a.work_date = v_d),
        'reports', coalesce((
          select jsonb_agg(jsonb_build_object('staffId', r.staff_id, 'type', r.type)) from public.jyoban_reports r
           where r.slot_id = s.id and r.work_date = v_d and r.voided_at is null), '[]'::jsonb),
        'assignees', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'staffId', st.id, 'staffNo', st.staff_no, 'name', st.name, 'phone', st.phone,
                   'push', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'endpoint', p.endpoint, 'p256dh', p.p256dh, 'auth', p.auth))
                                       from public.jyoban_push_subscriptions p where p.staff_id = st.id and p.failed_at is null), '[]'::jsonb)))
            from public.jyoban_slot_staff a join public.staff st on st.id = a.staff_id and coalesce(st.is_active, true)
           where a.slot_id = s.id), '[]'::jsonb),
        'sent', coalesce((
          select jsonb_agg(jsonb_build_object('staffId', n.staff_id, 'reportType', n.report_type, 'step', n.step, 'channel', n.channel))
            from public.jyoban_notifications n where n.slot_id = s.id and n.work_date = v_d), '[]'::jsonb)
      );
    end loop;
  end loop;
  return v_out;
end $$;

-- 送る前に「この知らせは自分が送る」と台帳に記録する。すでに記録があれば null（＝送らない）
create or replace function public.jyoban_claim_call(
  p_company_id uuid, p_slot_id uuid, p_work_date date, p_report_type text, p_step text, p_channel text, p_staff_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.jyoban_notifications(company_id, slot_id, work_date, report_type, step, channel, staff_id)
    values (p_company_id, p_slot_id, p_work_date, p_report_type, p_step, p_channel, p_staff_id)
  on conflict do nothing
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.jyoban_finish_call(p_id uuid, p_status text, p_detail text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.jyoban_notifications
     set status = p_status, detail = left(p_detail, 500), finished_at = now()
   where id = p_id;
end $$;

-- 無効になったPush購読先（410 Gone 等）を使わないようにする
create or replace function public.jyoban_mark_push_failed(p_subscription_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.jyoban_push_subscriptions set failed_at = now() where id = p_subscription_id;
$$;

-- ── 12) 権限 ─────────────────────────────────────────────────────
grant execute on function public.jyoban_context(text,text) to anon, authenticated;
grant execute on function public.jyoban_submit_report(text,uuid,text,text,text,text,text,text,text,uuid,timestamptz) to anon, authenticated;

revoke all on function public.jyoban_save_push_subscription(text,text,text,text) from public;
grant execute on function public.jyoban_save_push_subscription(text,text,text,text) to anon, authenticated;

revoke all on function public.company_list_slot_staff(uuid)        from public, anon;
revoke all on function public.company_set_slot_staff(uuid,uuid[])  from public, anon;
revoke all on function public.company_set_staff_phone(uuid,text)   from public, anon;
grant execute on function public.company_list_slot_staff(uuid)       to authenticated;
grant execute on function public.company_set_slot_staff(uuid,uuid[]) to authenticated;
grant execute on function public.company_set_staff_phone(uuid,text)  to authenticated;

-- 通知ワーカーだけが使う（電話番号・購読先を含むため anon/authenticated には出さない）
revoke all on function public.jyoban_call_candidates(timestamptz)                       from public, anon, authenticated;
revoke all on function public.jyoban_claim_call(uuid,uuid,date,text,text,text,uuid)      from public, anon, authenticated;
revoke all on function public.jyoban_finish_call(uuid,text,text)                         from public, anon, authenticated;
revoke all on function public.jyoban_mark_push_failed(uuid)                              from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.jyoban_call_candidates(timestamptz) to service_role';
    execute 'grant execute on function public.jyoban_claim_call(uuid,uuid,date,text,text,text,uuid) to service_role';
    execute 'grant execute on function public.jyoban_finish_call(uuid,text,text) to service_role';
    execute 'grant execute on function public.jyoban_mark_push_failed(uuid) to service_role';
  end if;
end $$;
