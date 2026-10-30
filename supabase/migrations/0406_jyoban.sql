-- 0406_jyoban.sql — 上番報告（出発連絡・上番連絡）Sprint1: 基盤
--   ・現場ごとの報告用QRトークン（sites.report_token）と共用端末フラグ
--   ・勤務枠（jyoban_slots）: 現場×勤務枠ごとに 出発/上番連絡の要否・締切・猶予・適用曜日
--   ・報告（jyoban_reports）/ 本社確認（jyoban_acks）: 表のみ先行定義（書込RPCは Sprint2/3）
-- 認証の二系統（0400 と同じ）:
--   ・会社(/co): Supabase Auth → app_company_id() で会社スコープ（RLS / SECURITY DEFINER RPC）
--   ・勤務員(/app): Auth ユーザーを持たないため、報告は Sprint2 の RPC（トークン＋スタッフNo＋PIN）経由のみ
-- 安全・冪等: 追加のみ（ADD COLUMN / CREATE IF NOT EXISTS / CREATE OR REPLACE）。破壊的DDLなし。
-- 依存: 0400（companies, sites.company_id, staff.staff_no, app_company_id, app_is_platform）

create extension if not exists pgcrypto with schema extensions;

-- ── 1) sites: 報告用QRトークン・共用端末 ─────────────────────────────
alter table public.sites add column if not exists report_token           text;
alter table public.sites add column if not exists report_token_issued_at timestamptz;
alter table public.sites add column if not exists shared_device_enabled  boolean default false;  -- 既存表への追加列はNULL許容（後方互換）。NULLはOFF扱い
create unique index if not exists uq_sites_report_token on public.sites(report_token) where report_token is not null;

-- ── 2) 勤務枠 ───────────────────────────────────────────────────────
create table if not exists public.jyoban_slots (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),
  site_id            uuid not null references public.sites(id) on delete cascade,
  name               text not null check (length(btrim(name)) > 0),
  work_start         text not null check (work_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  work_end           text not null check (work_end   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  departure_required boolean not null default false,
  departure_due      text check (departure_due is null or departure_due ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  onduty_required    boolean not null default true,
  onduty_due         text check (onduty_due is null or onduty_due ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  grace_min          int  not null default 5 check (grace_min between 0 and 120),
  weekdays           smallint[] not null default '{0,1,2,3,4,5,6}'
                     check (cardinality(weekdays) > 0 and weekdays <@ '{0,1,2,3,4,5,6}'::smallint[]),
  is_active          boolean not null default true,
  sort_order         int not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint jyoban_slots_need_one   check (departure_required or onduty_required),
  constraint jyoban_slots_dep_due    check (not departure_required or departure_due is not null),
  constraint jyoban_slots_onduty_due check (not onduty_required or onduty_due is not null)
);
create index if not exists idx_jyoban_slots_site on public.jyoban_slots(site_id, sort_order);
create index if not exists idx_jyoban_slots_company on public.jyoban_slots(company_id);

create or replace function public.jyoban_touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_jyoban_slots_touch on public.jyoban_slots;
create trigger trg_jyoban_slots_touch before update on public.jyoban_slots
  for each row execute function public.jyoban_touch_updated_at();

-- ── 3) 報告（隊員 → 本社）・本社確認 ─────────────────────────────────
create table if not exists public.jyoban_reports (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  site_id     uuid not null references public.sites(id),
  slot_id     uuid not null references public.jyoban_slots(id),
  work_date   date not null,                      -- 勤務日（=勤務開始日）
  type        text not null check (type in ('departure','onduty','other')),
  staff_id    uuid references public.staff(id),
  staff_no    text not null,
  staff_name  text not null,
  other_kind  text check (other_kind is null or other_kind in ('late','oversleep','traffic_delay','sick','absent','other')),
  eta         text check (eta is null or eta ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  note        text check (note is null or length(note) <= 500),
  client_at   timestamptz,                        -- 端末で押した時刻（オフライン送信の参考）
  received_at timestamptz not null default now(), -- 判定に使うサーバ受信時刻
  voided_at   timestamptz,                        -- 取消（削除せず残す）
  constraint jyoban_reports_other_kind check ((type = 'other') = (other_kind is not null))
);
create index if not exists idx_jyoban_reports_board on public.jyoban_reports(company_id, work_date);
create index if not exists idx_jyoban_reports_slot  on public.jyoban_reports(slot_id, work_date);

create table if not exists public.jyoban_acks (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  slot_id    uuid not null references public.jyoban_slots(id) on delete cascade,
  work_date  date not null,
  acked_by   uuid,                                -- auth.uid()（本社担当者）
  memo       text check (memo is null or length(memo) <= 500),
  created_at timestamptz not null default now(),
  unique (slot_id, work_date)
);

-- 会社コンソールからの作成時は company_id を省略可（ログイン中の自社IDを既定にする。RLSで再検証）
alter table public.jyoban_slots alter column company_id set default public.app_company_id();
alter table public.jyoban_acks  alter column company_id set default public.app_company_id();

-- ── 4) RLS: 運営=全件 / 会社=自社のみ（勤務員はRPC経由のみ・直接アクセス不可）──────
alter table public.jyoban_slots   enable row level security;
alter table public.jyoban_reports enable row level security;
alter table public.jyoban_acks    enable row level security;

-- 自社の現場か（勤務枠・確認の越境INSERT防止）
create or replace function public.jyoban_site_in_my_company(p_site_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sites s
                  where s.id = p_site_id and s.company_id = public.app_company_id());
$$;
create or replace function public.jyoban_slot_in_my_company(p_slot_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.jyoban_slots j
                  where j.id = p_slot_id and j.company_id = public.app_company_id());
$$;

drop policy if exists jyoban_slots_platform on public.jyoban_slots;
drop policy if exists jyoban_slots_company  on public.jyoban_slots;
create policy jyoban_slots_platform on public.jyoban_slots for all
  using (public.app_is_platform()) with check (public.app_is_platform());
create policy jyoban_slots_company on public.jyoban_slots for all
  using (company_id = public.app_company_id())
  with check (company_id = public.app_company_id() and public.jyoban_site_in_my_company(site_id));

-- 報告: 会社は閲覧のみ（作成は Sprint2 の勤務員RPC、取消もRPC）
drop policy if exists jyoban_reports_platform on public.jyoban_reports;
drop policy if exists jyoban_reports_company  on public.jyoban_reports;
create policy jyoban_reports_platform on public.jyoban_reports for select
  using (public.app_is_platform());
create policy jyoban_reports_company on public.jyoban_reports for select
  using (company_id = public.app_company_id());

drop policy if exists jyoban_acks_platform on public.jyoban_acks;
drop policy if exists jyoban_acks_company  on public.jyoban_acks;
create policy jyoban_acks_platform on public.jyoban_acks for select
  using (public.app_is_platform());
create policy jyoban_acks_company on public.jyoban_acks for all
  using (company_id = public.app_company_id())
  with check (company_id = public.app_company_id() and public.jyoban_slot_in_my_company(slot_id));

-- ── 5) 会社RPC（sites は現場スコープRLSのため SECURITY DEFINER で会社スコープを内部強制）──
-- 5-1) 自社の現場一覧（上番報告の設定状況つき）
create or replace function public.company_list_jyoban_sites()
returns table(site_id uuid, name text, code text, dept text, is_active boolean,
              report_token text, report_token_issued_at timestamptz,
              shared_device_enabled boolean, slot_count int)
language plpgsql stable security definer set search_path = public as $$
declare v_company uuid;
begin
  v_company := public.app_company_id();
  if v_company is null then raise exception '権限がありません'; end if;
  return query
    select s.id, s.name, s.code, s.dept, coalesce(s.is_active, true),
           s.report_token, s.report_token_issued_at, coalesce(s.shared_device_enabled, false),
           (select count(*)::int from public.jyoban_slots j where j.site_id = s.id and j.is_active)
      from public.sites s
     where s.company_id = v_company
     order by s.name;
end $$;

-- 5-2) 報告用QRトークンを発行/再発行（旧トークンは即無効）。URL安全な24文字。
create or replace function public.company_issue_report_token(p_site_id uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_token text;
begin
  if not public.jyoban_site_in_my_company(p_site_id) then raise exception '対象現場が自社ではありません'; end if;
  loop
    v_token := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_');
    exit when not exists (select 1 from public.sites where report_token = v_token);
  end loop;
  update public.sites set report_token = v_token, report_token_issued_at = now() where id = p_site_id;
  return v_token;
end $$;

-- 5-3) 共用端末（現場スマホ）の有無
create or replace function public.company_set_shared_device(p_site_id uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.jyoban_site_in_my_company(p_site_id) then raise exception '対象現場が自社ではありません'; end if;
  update public.sites set shared_device_enabled = coalesce(p_enabled, false) where id = p_site_id;
end $$;

revoke all on function public.company_list_jyoban_sites()             from public, anon;
revoke all on function public.company_issue_report_token(uuid)        from public, anon;
revoke all on function public.company_set_shared_device(uuid,boolean) from public, anon;
grant execute on function public.company_list_jyoban_sites()             to authenticated;
grant execute on function public.company_issue_report_token(uuid)        to authenticated;
grant execute on function public.company_set_shared_device(uuid,boolean) to authenticated;
grant select, insert, update, delete on public.jyoban_slots to authenticated;
grant select on public.jyoban_reports to authenticated;
grant select, insert, update, delete on public.jyoban_acks to authenticated;

-- 次段(Sprint2): 勤務員の端末登録（スタッフNo＋PIN）・報告RPC（トークンで現場を解決）・取消RPC。
