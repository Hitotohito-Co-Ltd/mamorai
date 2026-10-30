-- 0407_jyoban_report.sql — 上番報告 Sprint2: 隊員の本人登録・報告・取消（勤務員PWA /app/r/<トークン>）
-- 本人確認:
--   ・個人スマホ: 初回のみ スタッフNo＋PIN（0400/0401 の staff.pin_hash）で照合し、端末シークレットを発行。
--               以後は 端末シークレット＋現場トークン で報告（シークレットはハッシュのみ保存）。
--   ・現場スマホ（共用）: 現場で共用端末がONのときだけ、報告のたびに スタッフNo＋PIN で照合（端末には何も残さない）。
--   ・PIN の連続失敗は 15分で5回までロック（jyoban_pin_attempts）。
-- 時刻: 判定はサーバ時刻（Asia/Tokyo）。勤務日の決め方は input-core resolveWorkDate と同じ規則。
-- 冪等: 送信待ちの再送に備え client_id で重複登録しない。同じ人・枠・日・種別の出発/上番連絡も二重登録しない。
-- 安全・冪等: 追加のみ。依存: 0400/0401（staff, pin_hash）, 0406（jyoban_*, sites.report_token）。

create extension if not exists pgcrypto with schema extensions;

-- ── 1) 端末・PIN試行・報告の追加列 ─────────────────────────────────
create table if not exists public.jyoban_devices (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  staff_id     uuid not null references public.staff(id) on delete cascade,
  secret_hash  text not null unique,             -- sha256(端末シークレット)
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists idx_jyoban_devices_staff on public.jyoban_devices(staff_id);

create table if not exists public.jyoban_pin_attempts (
  company_id   uuid not null,
  staff_no     text not null,
  attempted_at timestamptz not null default now()
);
create index if not exists idx_jyoban_pin_attempts on public.jyoban_pin_attempts(company_id, staff_no, attempted_at);

alter table public.jyoban_reports add column if not exists client_id uuid;
alter table public.jyoban_reports add column if not exists device_id uuid references public.jyoban_devices(id);
alter table public.jyoban_reports add column if not exists via_shared boolean default false;
create unique index if not exists uq_jyoban_reports_client on public.jyoban_reports(client_id) where client_id is not null;

alter table public.jyoban_devices      enable row level security;
alter table public.jyoban_pin_attempts enable row level security;
-- 会社は自社の端末一覧を閲覧・失効できる（紛失時）。PIN試行はRPC内部のみ（ポリシーなし＝直接アクセス不可）
drop policy if exists jyoban_devices_company on public.jyoban_devices;
create policy jyoban_devices_company on public.jyoban_devices for select
  using (company_id = public.app_company_id());
drop policy if exists jyoban_devices_company_upd on public.jyoban_devices;
create policy jyoban_devices_company_upd on public.jyoban_devices for update
  using (company_id = public.app_company_id()) with check (company_id = public.app_company_id());
grant select, update (revoked_at) on public.jyoban_devices to authenticated;

-- ── 2) 内部ヘルパ（anon に直接は公開しない）──────────────────────────
create or replace function public.jyoban_now_local() returns timestamp
language sql stable as $$ select (now() at time zone 'Asia/Tokyo') $$;

-- トークン→現場（稼働中の会社・現場のみ）
create or replace function public.jyoban_site_by_token(p_token text)
returns public.sites language plpgsql stable security definer set search_path = public as $$
declare v public.sites;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{6,64}$' then raise exception 'QRコードが無効です'; end if;
  select s.* into v from public.sites s join public.companies c on c.id = s.company_id
   where s.report_token = p_token and coalesce(s.is_active, true) and c.is_active;
  if v.id is null then raise exception 'QRコードが無効です。現場に掲示された最新のQRを読み取ってください'; end if;
  return v;
end $$;

-- スタッフNo＋PIN 照合（15分で5回失敗したらロック）。
--   失敗時に例外を投げると試行記録まで巻き戻るため、例外ではなく error（'locked'|'invalid'）で返す。
create or replace function public.jyoban_verify_pin(p_company_id uuid, p_staff_no text, p_pin text)
returns table(staff_id uuid, error text) language plpgsql security definer set search_path = public, extensions as $$
declare v public.staff; v_fail int; v_no text := coalesce(btrim(p_staff_no), '');
begin
  select count(*) into v_fail from public.jyoban_pin_attempts a
   where a.company_id = p_company_id and a.staff_no = v_no and a.attempted_at > now() - interval '15 minutes';
  if v_fail >= 5 then staff_id := null; error := 'locked'; return next; return; end if;
  select * into v from public.staff s
   where s.company_id = p_company_id and s.staff_no = v_no and coalesce(s.is_active, true);
  if v.id is null or v.pin_hash is null or v.pin_hash <> extensions.crypt(coalesce(p_pin, ''), v.pin_hash) then
    insert into public.jyoban_pin_attempts(company_id, staff_no) values (p_company_id, v_no);
    staff_id := null; error := 'invalid'; return next; return;
  end if;
  delete from public.jyoban_pin_attempts a where a.company_id = p_company_id and a.staff_no = v_no;
  staff_id := v.id; error := null; return next;
end $$;

create or replace function public.jyoban_pin_message(p_error text) returns text
language sql immutable as $$
  select case p_error
    when 'locked' then '入力ミスが続いたため一時的にロックしています。15分後にお試しいただくか、本社へ連絡してください'
    else 'スタッフNoまたはPINが正しくありません' end
$$;

-- 端末シークレット → スタッフ（同じ会社・失効していない端末・在籍中のみ）
create or replace function public.jyoban_staff_by_device(p_company_id uuid, p_secret text)
returns table(device_id uuid, staff_id uuid) language plpgsql security definer set search_path = public, extensions as $$
declare v_dev public.jyoban_devices;
begin
  if p_secret is null or length(p_secret) < 32 then return; end if;
  select d.* into v_dev from public.jyoban_devices d
   where d.secret_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex')
     and d.company_id = p_company_id and d.revoked_at is null;
  if v_dev.id is null then return; end if;
  if not exists (select 1 from public.staff s where s.id = v_dev.staff_id and coalesce(s.is_active, true)) then return; end if;
  update public.jyoban_devices set last_seen_at = now() where id = v_dev.id;
  device_id := v_dev.id; staff_id := v_dev.staff_id; return next;
end $$;

-- 押した時刻（現地）がどの勤務日に当たるか。input-core resolveWorkDate と同じ規則
--   受付 = [開始−12h, 終了＋2h]（終了≦開始は翌日終了）。複数該当は勤務中→開始が近い順。
create or replace function public.jyoban_work_date(p_slot public.jyoban_slots, p_now timestamp)
returns date language plpgsql stable as $$
declare v_start int; v_end int; v_t int; v_d date; v_best date; v_best_in boolean; v_best_dist int; v_in boolean; v_dist int; o int;
begin
  if not p_slot.is_active then return null; end if;
  v_start := split_part(p_slot.work_start, ':', 1)::int * 60 + split_part(p_slot.work_start, ':', 2)::int;
  v_end   := split_part(p_slot.work_end,   ':', 1)::int * 60 + split_part(p_slot.work_end,   ':', 2)::int;
  if v_end <= v_start then v_end := v_end + 1440; end if;
  foreach o in array array[-1, 0, 1] loop
    v_d := p_now::date + o;
    v_t := extract(hour from p_now)::int * 60 + extract(minute from p_now)::int - o * 1440;
    continue when v_t < v_start - 720 or v_t > v_end + 120;
    continue when not (extract(dow from v_d)::smallint = any(p_slot.weekdays));
    v_in := v_t between v_start and v_end;
    v_dist := abs(v_t - v_start);
    if v_best is null or (v_in and not v_best_in) or (v_in = v_best_in and v_dist < v_best_dist) then
      v_best := v_d; v_best_in := v_in; v_best_dist := v_dist;
    end if;
  end loop;
  return v_best;
end $$;

revoke all on function public.jyoban_site_by_token(text)               from public, anon, authenticated;
revoke all on function public.jyoban_verify_pin(uuid,text,text)         from public, anon, authenticated;
revoke all on function public.jyoban_work_date(public.jyoban_slots,timestamp) from public, anon, authenticated;
revoke all on function public.jyoban_staff_by_device(uuid,text)         from public, anon, authenticated;

-- ── 3) 公開RPC（勤務員PWAから anon で呼ぶ）──────────────────────────
-- 3-1) 個人スマホの本人登録: スタッフNo＋PIN → 端末シークレット（この1回だけ平文で返す）。PIN誤りは error で返す
create or replace function public.jyoban_register_device(p_token text, p_staff_no text, p_pin text, p_user_agent text default null)
returns table(device_secret text, staff_no text, staff_name text, pin_must_change boolean, error text)
language plpgsql security definer set search_path = public, extensions as $$
declare v_site public.sites; v_staff public.staff; v_check record; v_secret text;
begin
  v_site := public.jyoban_site_by_token(p_token);
  select * into v_check from public.jyoban_verify_pin(v_site.company_id, p_staff_no, p_pin);
  if v_check.error is not null then
    device_secret := null; staff_no := null; staff_name := null; pin_must_change := null;
    error := public.jyoban_pin_message(v_check.error); return next; return;
  end if;
  select * into v_staff from public.staff s where s.id = v_check.staff_id;
  v_secret := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.jyoban_devices(company_id, staff_id, secret_hash, user_agent)
    values (v_site.company_id, v_staff.id, encode(extensions.digest(v_secret, 'sha256'), 'hex'), left(p_user_agent, 300));
  device_secret := v_secret; staff_no := v_staff.staff_no; staff_name := v_staff.name;
  pin_must_change := coalesce(v_staff.pin_must_change, false); error := null; return next;
end $$;

-- 3-2) 報告画面の表示内容: 現場・本人（端末登録済みなら）・現在受付中の勤務枠と報告状況
--   個人スマホ: 本人の報告のみ。共用端末: 当該枠の報告（氏名・時刻）を返す。
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
      'departure_required', s.departure_required, 'departure_due', s.departure_due,
      'onduty_required', s.onduty_required, 'onduty_due', s.onduty_due, 'grace_min', s.grace_min,
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

-- 3-3) 報告の送信
--   本人確認は 端末シークレット（個人）か、共用端末ONの現場でのみ スタッフNo＋PIN。
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

  -- 送信待ちの再送（同じ client_id）は最初の登録結果を返す
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

  if p_type = 'departure' and not v_slot.departure_required then raise exception 'この勤務枠は出発連絡が不要です'; end if;
  if p_type = 'onduty' and not v_slot.onduty_required then raise exception 'この勤務枠は上番連絡が不要です'; end if;
  if p_type not in ('departure','onduty','other') then raise exception '報告の種類が不正です'; end if;
  if p_type = 'other' then
    if p_other_kind is null or p_other_kind not in ('late','oversleep','traffic_delay','sick','absent','other') then raise exception '内容を選んでください'; end if;
    if p_other_kind in ('late','oversleep','traffic_delay') and (p_eta is null or p_eta !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
      raise exception '到着見込み時刻を入力してください';
    end if;
    if p_other_kind = 'other' and coalesce(btrim(p_note), '') = '' then raise exception '内容をメモに入力してください'; end if;
  end if;

  -- 出発/上番は1人・1枠・1日1回（取消すれば再報告できる）
  if p_type in ('departure','onduty') then
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

-- 3-4) 押し間違いの取消（本人の報告・送信から12時間以内）。PIN誤りは戻り値のエラー文で返す（null=成功）
create or replace function public.jyoban_void_report(
  p_token text, p_report_id uuid,
  p_device_secret text default null, p_staff_no text default null, p_pin text default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_site public.sites; v_staff_id uuid; v_check record; n int;
begin
  v_site := public.jyoban_site_by_token(p_token);
  select d.staff_id into v_staff_id from public.jyoban_staff_by_device(v_site.company_id, p_device_secret) d;
  if v_staff_id is null then
    if not coalesce(v_site.shared_device_enabled, false) then raise exception '本人登録が必要です'; end if;
    select * into v_check from public.jyoban_verify_pin(v_site.company_id, p_staff_no, p_pin);
    if v_check.error is not null then return public.jyoban_pin_message(v_check.error); end if;
    v_staff_id := v_check.staff_id;
  end if;
  update public.jyoban_reports set voided_at = now()
   where id = p_report_id and site_id = v_site.id and staff_id = v_staff_id and voided_at is null
     and received_at > now() - interval '12 hours';
  get diagnostics n = row_count;
  if n = 0 then raise exception '取り消せる報告が見つかりません'; end if;
  return null;
end $$;

grant execute on function public.jyoban_register_device(text,text,text,text) to anon, authenticated;
grant execute on function public.jyoban_context(text,text)                   to anon, authenticated;
grant execute on function public.jyoban_submit_report(text,uuid,text,text,text,text,text,text,text,uuid,timestamptz) to anon, authenticated;
grant execute on function public.jyoban_void_report(text,uuid,text,text,text) to anon, authenticated;
