-- 0413_jyoban_operation.sql — 上下番だけで運用するための台帳（2026-11）
--   要件定義 第4.1節の R2・R4・R5・R6 と、本日の現場一覧（設計 ⑦）の手続き。
--   1) 約定人数（契約の配置人数）を勤務枠×曜日で持つ（R2）
--   2) 勤務員は報告を取り消せない。誤りは現場PC・本社が理由を書いて訂正し、元の記録と履歴を残す（R4）
--      訂正 = 取消（void）と、後から登録（add：スマホを忘れた等）
--   3) 本日の現場一覧の手続き（会社＝本社PC・支店・管理者／現場PC）と「確認済みにする」
--      勤務表外（R5）・シフト記入不要（R6）の判定は画面側（input-core の computeCrewStatus）で、台帳は材料を返す
-- 安全・冪等: 追加のみ（ADD COLUMN IF NOT EXISTS / CREATE IF NOT EXISTS / CREATE OR REPLACE、制約は存在確認つき）。
-- 依存: 0406〜0409（上番報告）、0411（ロール・現場PCセッション）、0412（位置確認）

-- ── 1) 約定人数（曜日別。0=日〜6=土の7要素。NULL＝未設定＝配置者の人数、配置者もなければ1名） ──
alter table public.jyoban_slots add column if not exists required_by_dow smallint[];
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'jyoban_slots_required_by_dow_chk') then
    alter table public.jyoban_slots add constraint jyoban_slots_required_by_dow_chk check (
      required_by_dow is null
      or (cardinality(required_by_dow) = 7 and 0 <= all(required_by_dow) and 99 >= all(required_by_dow)
          and array_position(required_by_dow, null) is null));
  end if;
end $$;

-- ── 2) 訂正の記録 ───────────────────────────────────────────────────
alter table public.jyoban_reports add column if not exists void_reason  text;   -- 取消の理由
alter table public.jyoban_reports add column if not exists voided_by    text;   -- 取消した人（表示用）
alter table public.jyoban_reports add column if not exists entered_by   text;   -- 後から登録した人（NULL＝本人のスマホから）
alter table public.jyoban_reports add column if not exists entry_reason text;   -- 後から登録の理由
alter table public.jyoban_acks    add column if not exists acked_label  text;   -- 確認した人（表示用。現場PCは「現場PC」）
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'jyoban_reports_correction_len_chk') then
    alter table public.jyoban_reports add constraint jyoban_reports_correction_len_chk check (
      (void_reason is null or length(void_reason) <= 200) and (entry_reason is null or length(entry_reason) <= 200)
      and (voided_by is null or length(voided_by) <= 200) and (entered_by is null or length(entered_by) <= 200));
  end if;
end $$;

create table if not exists public.jyoban_report_corrections (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  site_id     uuid not null references public.sites(id),
  report_id   uuid not null references public.jyoban_reports(id),
  action      text not null check (action in ('void', 'add')),
  reason      text not null check (length(btrim(reason)) between 2 and 200),
  actor_kind  text not null check (actor_kind in ('company', 'sitepc')),
  actor_user  uuid,
  actor_label text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_jyoban_report_corrections_site on public.jyoban_report_corrections(site_id, created_at desc);
alter table public.jyoban_report_corrections enable row level security;
drop policy if exists jyoban_report_corrections_read on public.jyoban_report_corrections;
create policy jyoban_report_corrections_read on public.jyoban_report_corrections for select
  using (public.app_is_platform() or company_id = public.app_company_id());
revoke insert, update, delete on public.jyoban_report_corrections from anon, authenticated;

-- 勤務員アプリからの取消は止める（R4）。関数は残し、実行権だけ外す
revoke all on function public.jyoban_void_report(text,uuid,text,text,text) from public, anon, authenticated;

-- ── 3) 権限の補助 ──────────────────────────────────────────────────
-- 本日の現場一覧を見て、確認済み・訂正ができる現場か（本社PC・管理者＝自社全現場、支店＝担当現場。教育センターは不可）
create or replace function public.app_can_watch_site(p_site_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_profiles p join public.sites s on s.id = p_site_id and s.company_id = p.company_id
     where p.user_id = auth.uid()
       and (p.role in ('company_admin', 'hq_operator')
            or (p.role = 'company_manager'
                and (not exists (select 1 from public.app_profile_sites a where a.user_id = p.user_id)
                     or exists (select 1 from public.app_profile_sites a where a.user_id = p.user_id and a.site_id = s.id)))));
$$;

-- ログイン中の会社アカウントの表示名（メール。取れなければ「本社」）
create or replace function public.app_actor_label() returns text
language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if to_regclass('auth.users') is not null and auth.uid() is not null then
    execute 'select email::text from auth.users where id = $1' into v using auth.uid();
  end if;
  return coalesce(nullif(v, ''), '本社');
end $$;

-- ── 4) 本日の現場一覧の材料 ─────────────────────────────────────────
--   勤務日 p_date（=勤務開始日）の、対象現場の勤務枠・約定人数・配置者・報告（取消・訂正・位置判定込み）・確認済み。
create or replace function public.jyoban_board_json(p_company_id uuid, p_site_ids uuid[], p_date date)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'date', p_date,
    'now_local', to_char(public.jyoban_now_local(), 'YYYY-MM-DD"T"HH24:MI'),
    'sites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'code', s.code,
        'slots', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', j.id, 'site_id', j.site_id, 'name', j.name, 'work_start', j.work_start, 'work_end', j.work_end,
            'departure_required', j.departure_required, 'departure_due', j.departure_due,
            'onduty_required', j.onduty_required, 'onduty_due', j.onduty_due,
            'wakeup_required', coalesce(j.wakeup_required, false), 'wakeup_due', j.wakeup_due,
            'offduty_required', coalesce(j.offduty_required, false), 'offduty_due', j.offduty_due,
            'grace_min', j.grace_min, 'weekdays', to_jsonb(j.weekdays), 'is_active', j.is_active,
            'required_by_dow', to_jsonb(j.required_by_dow),
            'roster', coalesce((
              select jsonb_agg(jsonb_build_object('staff_no', st.staff_no, 'name', st.name, 'phone', st.phone) order by st.staff_no)
                from public.jyoban_slot_staff ss join public.staff st on st.id = ss.staff_id
               where ss.slot_id = j.id and coalesce(st.is_active, true)), '[]'::jsonb),
            'ack', (
              select jsonb_build_object('at', to_char(a.created_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD"T"HH24:MI'),
                                        'memo', a.memo, 'by', coalesce(a.acked_label, '本社'))
                from public.jyoban_acks a where a.slot_id = j.id and a.work_date = p_date),
            'reports', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', r.id, 'type', r.type, 'staff_no', r.staff_no, 'staff_name', r.staff_name,
                'phone', (select st2.phone from public.staff st2 where st2.id = r.staff_id),
                'other_kind', r.other_kind, 'eta', r.eta, 'note', r.note,
                'received_at', to_char(r.received_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD"T"HH24:MI'),
                'voided', r.voided_at is not null, 'void_reason', r.void_reason, 'voided_by', r.voided_by,
                'entered_by', r.entered_by, 'entry_reason', r.entry_reason,
                'geo_status', r.geo_status, 'geo_distance_m', r.geo_distance_m) order by r.received_at)
                from public.jyoban_reports r where r.slot_id = j.id and r.work_date = p_date), '[]'::jsonb)
          ) order by j.sort_order, j.work_start, j.name)
            from public.jyoban_slots j where j.site_id = s.id and j.is_active), '[]'::jsonb)
      ) order by s.name)
        from public.sites s
       where s.company_id = p_company_id and (p_site_ids is null or s.id = any(p_site_ids))), '[]'::jsonb));
$$;

create or replace function public.company_jyoban_board(p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_company uuid; v_sites uuid[];
begin
  select p.company_id into v_company from public.app_profiles p
   where p.user_id = auth.uid() and p.role in ('company_admin', 'hq_operator', 'company_manager');
  if v_company is null then raise exception '本日の現場一覧を見る権限がありません'; end if;
  select array_agg(s.id) into v_sites from public.sites s where s.company_id = v_company and public.app_can_watch_site(s.id);
  return public.jyoban_board_json(v_company, coalesce(v_sites, '{}'::uuid[]), coalesce(p_date, public.jyoban_now_local()::date));
end $$;

create or replace function public.sitepc_jyoban_board(p_session text, p_date date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select * into v from public.sitepc_resolve(p_session);
  return public.jyoban_board_json(v.company_id, array[v.site_id], coalesce(p_date, public.jyoban_now_local()::date));
end $$;

-- ── 5) 確認済みにする ──────────────────────────────────────────────
create or replace function public.jyoban_do_ack(p_slot_id uuid, p_date date, p_memo text, p_by uuid, p_label text)
returns void language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  select j.company_id into v_company from public.jyoban_slots j where j.id = p_slot_id;
  insert into public.jyoban_acks(company_id, slot_id, work_date, acked_by, memo, acked_label)
    values (v_company, p_slot_id, p_date, p_by, nullif(left(btrim(coalesce(p_memo, '')), 500), ''), p_label)
    on conflict (slot_id, work_date) do nothing;
end $$;

create or replace function public.company_jyoban_ack(p_slot_id uuid, p_date date, p_memo text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.jyoban_slots j where j.id = p_slot_id and public.app_can_watch_site(j.site_id)) then
    raise exception 'この勤務枠を確認する権限がありません';
  end if;
  perform public.jyoban_do_ack(p_slot_id, p_date, p_memo, auth.uid(), public.app_actor_label());
end $$;

create or replace function public.sitepc_jyoban_ack(p_session text, p_slot_id uuid, p_date date, p_memo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select * into v from public.sitepc_resolve(p_session);
  if not exists (select 1 from public.jyoban_slots j where j.id = p_slot_id and j.site_id = v.site_id) then
    raise exception 'この現場の勤務枠ではありません';
  end if;
  perform public.jyoban_do_ack(p_slot_id, p_date, p_memo, null, '現場PC');
end $$;

-- ── 6) 訂正：取消 ─────────────────────────────────────────────────
create or replace function public.jyoban_do_void(p_report_id uuid, p_reason text, p_kind text, p_user uuid, p_label text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.jyoban_reports; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if length(v_reason) < 2 then raise exception '訂正の理由を入力してください'; end if;
  if length(v_reason) > 200 then raise exception '理由は200文字以内で入力してください'; end if;
  select * into r from public.jyoban_reports where id = p_report_id for update;
  if r.id is null then raise exception '報告が見つかりません'; end if;
  if r.voided_at is not null then raise exception 'この報告はすでに取り消されています'; end if;
  update public.jyoban_reports set voided_at = now(), void_reason = v_reason, voided_by = p_label where id = r.id;
  insert into public.jyoban_report_corrections(company_id, site_id, report_id, action, reason, actor_kind, actor_user, actor_label)
    values (r.company_id, r.site_id, r.id, 'void', v_reason, p_kind, p_user, p_label);
end $$;

create or replace function public.company_jyoban_void(p_report_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.jyoban_reports r where r.id = p_report_id and public.app_can_watch_site(r.site_id)) then
    raise exception 'この報告を訂正する権限がありません';
  end if;
  perform public.jyoban_do_void(p_report_id, p_reason, 'company', auth.uid(), public.app_actor_label());
end $$;

create or replace function public.sitepc_jyoban_void(p_session text, p_report_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select * into v from public.sitepc_resolve(p_session);
  if not exists (select 1 from public.jyoban_reports r where r.id = p_report_id and r.site_id = v.site_id) then
    raise exception 'この現場の報告ではありません';
  end if;
  perform public.jyoban_do_void(p_report_id, p_reason, 'sitepc', null,
    '現場PC（' || coalesce((select s.name from public.sites s where s.id = v.site_id), '') || '）');
end $$;

-- ── 7) 訂正：後から登録（スマホを忘れた・電池切れ等） ───────────────────
--   p_time は現地時刻 'HH:MM'。下番で勤務開始以前の時刻は翌日、起床・出発・上番で勤務開始より12時間超あとは前日とみなす。
create or replace function public.jyoban_do_add(
  p_slot_id uuid, p_date date, p_type text, p_staff_no text, p_time text, p_reason text,
  p_kind text, p_user uuid, p_label text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_slot public.jyoban_slots; v_staff public.staff; v_reason text := btrim(coalesce(p_reason, ''));
        v_t int; v_s int; v_day date; v_at timestamptz; v_id uuid;
begin
  if length(v_reason) < 2 then raise exception '訂正の理由を入力してください'; end if;
  if length(v_reason) > 200 then raise exception '理由は200文字以内で入力してください'; end if;
  if p_type is null or p_type not in ('wakeup', 'departure', 'onduty', 'offduty') then raise exception '報告の種類を選んでください'; end if;
  if p_time is null or p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception '時刻を HH:MM で入力してください'; end if;
  if p_date is null then raise exception '勤務日を指定してください'; end if;
  select * into v_slot from public.jyoban_slots where id = p_slot_id;
  if v_slot.id is null then raise exception '勤務枠が見つかりません'; end if;
  select * into v_staff from public.staff st
   where st.company_id = v_slot.company_id and st.staff_no = btrim(coalesce(p_staff_no, '')) and coalesce(st.is_active, true);
  if v_staff.id is null then raise exception 'スタッフNoが見つかりません（在籍中の自社の勤務員のみ）'; end if;
  if exists (select 1 from public.jyoban_reports r where r.slot_id = v_slot.id and r.work_date = p_date and r.type = p_type
              and r.staff_id = v_staff.id and r.voided_at is null) then
    raise exception 'この人の同じ報告がすでにあります。誤りなら先に取り消してください';
  end if;
  v_t := split_part(p_time, ':', 1)::int * 60 + split_part(p_time, ':', 2)::int;
  v_s := split_part(v_slot.work_start, ':', 1)::int * 60 + split_part(v_slot.work_start, ':', 2)::int;
  v_day := p_date;
  if p_type = 'offduty' and v_t <= v_s then v_day := p_date + 1;
  elsif p_type <> 'offduty' and v_t - v_s > 720 then v_day := p_date - 1;
  end if;
  v_at := (v_day + make_interval(mins => v_t)) at time zone 'Asia/Tokyo';
  if v_at > now() + interval '5 minutes' then raise exception 'まだ来ていない時刻は登録できません'; end if;
  insert into public.jyoban_reports(company_id, site_id, slot_id, work_date, type, staff_id, staff_no, staff_name,
                                    received_at, client_at, entered_by, entry_reason)
    values (v_slot.company_id, v_slot.site_id, v_slot.id, p_date, p_type, v_staff.id, v_staff.staff_no, v_staff.name,
            v_at, v_at, p_label, v_reason)
    returning id into v_id;
  insert into public.jyoban_report_corrections(company_id, site_id, report_id, action, reason, actor_kind, actor_user, actor_label)
    values (v_slot.company_id, v_slot.site_id, v_id, 'add', v_reason, p_kind, p_user, p_label);
  return v_id;
end $$;

create or replace function public.company_jyoban_add_report(
  p_slot_id uuid, p_date date, p_type text, p_staff_no text, p_time text, p_reason text
) returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.jyoban_slots j where j.id = p_slot_id and public.app_can_watch_site(j.site_id)) then
    raise exception 'この勤務枠を訂正する権限がありません';
  end if;
  return public.jyoban_do_add(p_slot_id, p_date, p_type, p_staff_no, p_time, p_reason, 'company', auth.uid(), public.app_actor_label());
end $$;

create or replace function public.sitepc_jyoban_add_report(
  p_session text, p_slot_id uuid, p_date date, p_type text, p_staff_no text, p_time text, p_reason text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select * into v from public.sitepc_resolve(p_session);
  if not exists (select 1 from public.jyoban_slots j where j.id = p_slot_id and j.site_id = v.site_id) then
    raise exception 'この現場の勤務枠ではありません';
  end if;
  return public.jyoban_do_add(p_slot_id, p_date, p_type, p_staff_no, p_time, p_reason, 'sitepc', null,
    '現場PC（' || coalesce((select s.name from public.sites s where s.id = v.site_id), '') || '）');
end $$;

-- ── 8) 権限 ────────────────────────────────────────────────────────
revoke all on function public.app_can_watch_site(uuid) from public, anon;
revoke all on function public.app_actor_label() from public, anon, authenticated;
revoke all on function public.jyoban_board_json(uuid,uuid[],date) from public, anon, authenticated;
revoke all on function public.jyoban_do_ack(uuid,date,text,uuid,text) from public, anon, authenticated;
revoke all on function public.jyoban_do_void(uuid,text,text,uuid,text) from public, anon, authenticated;
revoke all on function public.jyoban_do_add(uuid,date,text,text,text,text,text,uuid,text) from public, anon, authenticated;
revoke all on function public.company_jyoban_board(date) from public, anon;
revoke all on function public.company_jyoban_ack(uuid,date,text) from public, anon;
revoke all on function public.company_jyoban_void(uuid,text) from public, anon;
revoke all on function public.company_jyoban_add_report(uuid,date,text,text,text,text) from public, anon;
revoke all on function public.sitepc_jyoban_board(text,date) from public;
revoke all on function public.sitepc_jyoban_ack(text,uuid,date,text) from public;
revoke all on function public.sitepc_jyoban_void(text,uuid,text) from public;
revoke all on function public.sitepc_jyoban_add_report(text,uuid,date,text,text,text,text) from public;
grant execute on function public.app_can_watch_site(uuid) to authenticated;
grant execute on function public.company_jyoban_board(date) to authenticated;
grant execute on function public.company_jyoban_ack(uuid,date,text) to authenticated;
grant execute on function public.company_jyoban_void(uuid,text) to authenticated;
grant execute on function public.company_jyoban_add_report(uuid,date,text,text,text,text) to authenticated;
grant execute on function public.sitepc_jyoban_board(text,date) to anon, authenticated;
grant execute on function public.sitepc_jyoban_ack(text,uuid,date,text) to anon, authenticated;
grant execute on function public.sitepc_jyoban_void(text,uuid,text) to anon, authenticated;
grant execute on function public.sitepc_jyoban_add_report(text,uuid,date,text,text,text,text) to anon, authenticated;
