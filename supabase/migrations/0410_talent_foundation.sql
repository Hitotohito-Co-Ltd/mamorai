-- 0410_talent_foundation.sql — 人材基盤の土台: スタッフ台帳（人）・案件・応募
-- 内容:
--   1) groups（グループ）と companies.group_id
--   2) persons（グループ共通で1人1件）と staff.person_id（既存 staff は「ある会社での雇用」として残す）
--   3) staff に雇用の期間・契約満了日（更新手続きの期限）を追加
--   4) job_roles（職種マスタ）/ jobs（案件）/ job_shifts（日時・人数）/ job_applications（応募）
--   5) RLS: 運営=全件 / 会社=自社の雇用・自社の案件のみ。他社の雇用・給与は見せない
-- 安全・冪等: 追加のみ（CREATE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS）。追加列はNULL許容。
-- 依存: 0400（companies, staff, app_is_platform, app_company_id）
-- 注意: 応募可否の判定は packages/input-core/src/talent/eligibility.ts が唯一の定義。DBは台帳と整合性の保証のみ行う。

-- ── 1) グループ ───────────────────────────────────────────────────
create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);
alter table public.companies add column if not exists group_id uuid references public.groups(id);

-- ── 2) 人 ─────────────────────────────────────────────────────────
create table if not exists public.persons (
  id                 uuid primary key default gen_random_uuid(),
  group_id           uuid not null references public.groups(id),
  name               text not null,
  name_kana          text,
  birth_date         date,
  phone              text,
  email              text,
  -- 共同利用への同意（登録時に本人へ通知して取得）
  consent_joint_use  boolean not null default false,
  consent_at         timestamptz,
  -- 在留カード（外国籍のみ）。期限前に通知する
  residence_work_allowed boolean,
  residence_expires_on   date,
  created_at         timestamptz not null default now()
);
create index if not exists idx_persons_group on public.persons(group_id);

alter table public.staff add column if not exists person_id uuid references public.persons(id);
alter table public.staff add column if not exists employment_type text;
alter table public.staff add column if not exists hired_on date;
alter table public.staff add column if not exists left_on date;
alter table public.staff add column if not exists contract_end_on date;
create index if not exists idx_staff_person on public.staff(person_id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'staff_employment_type_chk') then
    alter table public.staff add constraint staff_employment_type_chk
      check (employment_type is null or employment_type in ('annual','fixed','spot','dispatch','regular'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'staff_left_after_hired') then
    alter table public.staff add constraint staff_left_after_hired
      check (left_on is null or hired_on is null or left_on >= hired_on);
  end if;
end $$;

-- ── 3) 職種・案件 ─────────────────────────────────────────────────
create table if not exists public.job_roles (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups(id),
  name         text not null,
  is_security  boolean not null default false,   -- 警備業務か
  night_work   boolean not null default false,   -- 夜間の有無
  required_cert text,                             -- 必要な検定（例: 交通誘導警備業務検定2級）
  unique (group_id, name)
);

create table if not exists public.jobs (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),   -- 雇用主
  site_id            uuid references public.sites(id),
  role_id            uuid references public.job_roles(id),
  title              text not null,
  form               text not null check (form in ('security','dispatch','spot','referral')),
  placement_mode     text not null default 'apply_review'
                       check (placement_mode in ('assign','apply_review','instant')),
  audience           text not null default 'registered'
                       check (audience in ('registered','worked_here','designated')),  -- 一般公開はしない
  status             text not null default 'draft' check (status in ('draft','published','filled','closed')),
  employment_days    int,
  hourly_wage        int,                -- 支払単価（円）
  billing_rate       int,                -- 請求単価（円）
  -- 運営の枠と警備の枠の線引きの確認（現場責任者・支店）
  boundary_confirmed_by text,
  boundary_confirmed_on date,
  created_by         text,
  created_at         timestamptz not null default now()
);
create index if not exists idx_jobs_company_status on public.jobs(company_id, status);

create table if not exists public.job_shifts (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs(id) on delete cascade,
  company_id  uuid not null references public.companies(id),
  work_date   date not null,
  start_time  text not null check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time    text not null check (end_time   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  headcount   int  not null check (headcount > 0),
  wage        int,
  slot_id     uuid references public.jyoban_slots(id)   -- 警備では既存の勤務枠と対応
);
create index if not exists idx_job_shifts_job on public.job_shifts(job_id, work_date);

create table if not exists public.job_applications (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id),
  job_shift_id   uuid not null references public.job_shifts(id) on delete cascade,
  staff_id       uuid not null references public.staff(id),
  status         text not null default 'applied'
                   check (status in ('applied','confirmed','rejected','cancelled_by_staff','cancelled_by_company')),
  -- 労働条件通知の確認（スポットは応募成立で労働契約が成立する）
  conditions_notified_at  timestamptz,
  conditions_confirmed_at timestamptz,
  decided_by     text,
  decided_at     timestamptz,
  created_at     timestamptz not null default now(),
  unique (job_shift_id, staff_id)
);
create index if not exists idx_job_apps_staff on public.job_applications(staff_id, status);

-- 警備の案件は、公開前に必ず会社・形・職種が揃っていること（派遣×警備の禁止は職種を持つ側で保証）
create or replace function public.jobs_guard_security_dispatch() returns trigger
language plpgsql as $$
declare v_sec boolean;
begin
  if new.role_id is not null then
    select is_security into v_sec from public.job_roles where id = new.role_id;
    if coalesce(v_sec, false) and new.form = 'dispatch' then
      raise exception '警備業務は派遣にできません（労働者派遣法第4条）';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_jobs_guard_security_dispatch on public.jobs;
create trigger trg_jobs_guard_security_dispatch before insert or update on public.jobs
  for each row execute function public.jobs_guard_security_dispatch();

-- ── 4) RLS ────────────────────────────────────────────────────────
alter table public.groups           enable row level security;
alter table public.persons          enable row level security;
alter table public.job_roles        enable row level security;
alter table public.jobs             enable row level security;
alter table public.job_shifts       enable row level security;
alter table public.job_applications enable row level security;

do $$
declare t text;
begin
  foreach t in array array['groups','persons','job_roles','jobs','job_shifts','job_applications'] loop
    execute format('drop policy if exists %I_platform on public.%I;', t, t);
    execute format('create policy %I_platform on public.%I for all using (public.app_is_platform()) with check (public.app_is_platform());', t, t);
  end loop;
  foreach t in array array['jobs','job_shifts','job_applications'] loop
    execute format('drop policy if exists %I_company on public.%I;', t, t);
    execute format('create policy %I_company on public.%I for all using (company_id = public.app_company_id()) with check (company_id = public.app_company_id());', t, t);
  end loop;
end $$;

-- 会社は、自社に雇用がある人だけを読める（他社の雇用は staff の会社スコープで隠れる）
drop policy if exists persons_company_read on public.persons;
create policy persons_company_read on public.persons for select
  using (exists (select 1 from public.staff s where s.person_id = persons.id and s.company_id = public.app_company_id()));
drop policy if exists groups_company_read on public.groups;
create policy groups_company_read on public.groups for select
  using (exists (select 1 from public.companies c where c.group_id = groups.id and c.id = public.app_company_id()));
drop policy if exists job_roles_company_read on public.job_roles;
create policy job_roles_company_read on public.job_roles for select
  using (exists (select 1 from public.companies c where c.group_id = job_roles.group_id and c.id = public.app_company_id()));
