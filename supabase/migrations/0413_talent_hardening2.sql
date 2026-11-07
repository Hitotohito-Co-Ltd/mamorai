-- 0413_talent_hardening2.sql — Adversary Sprint 8 第2回の指摘（FIND-101/102/103/109）
-- 内容:
--   1) persons の会社管理者の参照: staff の RLS（0202 の FORCE RLS）に依存せず、自社に雇用がある人を読めるようにする（SECURITY DEFINER の判定関数）
--   2) jobs: 派遣は職種の指定が必須（職種なしで警備×派遣の禁止を回避できない）。線引き確認は確認者が空でなく確認日があること。site_id は案件と同じ会社の現場のみ
--   3) job_shifts: slot_id（勤務枠）は案件と同じ会社のものだけ
-- 安全・冪等: 追加のみ（CREATE OR REPLACE FUNCTION、DROP POLICY IF EXISTS→CREATE POLICY、DROP TRIGGER IF EXISTS→CREATE TRIGGER）。列・データは変えない。
-- 依存: 0202（staff の FORCE RLS）, 0410, 0412

-- ── 1) persons の可視性 ───────────────────────────────────────────
create or replace function public.app_company_has_person(p_person_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.staff s
     where s.person_id = p_person_id and s.company_id = public.app_company_id()
  );
$$;
revoke all on function public.app_company_has_person(uuid) from public;
revoke all on function public.app_company_has_person(uuid) from anon;
grant execute on function public.app_company_has_person(uuid) to authenticated;

drop policy if exists persons_company_read on public.persons;
create policy persons_company_read on public.persons for select
  using (public.app_company_has_person(id));

-- ── 2) jobs ───────────────────────────────────────────────────────
create or replace function public.jobs_guard_security_dispatch() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_sec boolean; v_role_group uuid; v_company_group uuid; v_site_company uuid;
begin
  if new.form = 'dispatch' and new.role_id is null then
    raise exception '派遣の案件には職種の指定が必要です（警備業務は派遣にできないため、職種で判定します）';
  end if;
  if new.role_id is not null then
    select is_security, group_id into v_sec, v_role_group from public.job_roles where id = new.role_id;
    select group_id into v_company_group from public.companies where id = new.company_id;
    if v_role_group is null or v_company_group is distinct from v_role_group then
      raise exception '職種が自社のグループに属していません';
    end if;
    if coalesce(v_sec, false) and new.form = 'dispatch' then
      raise exception '警備業務は派遣にできません（労働者派遣法第4条）';
    end if;
  end if;
  if new.site_id is not null then
    select company_id into v_site_company from public.sites where id = new.site_id;
    if v_site_company is distinct from new.company_id then
      raise exception '現場が案件の会社に属していません';
    end if;
  end if;
  if new.status = 'published' and coalesce(new.needs_boundary_check, false)
     and (coalesce(btrim(new.boundary_confirmed_by), '') = '' or new.boundary_confirmed_on is null) then
    raise exception '運営枠と警備枠の線引きの確認（確認者と確認日）が無い案件は公開できません';
  end if;
  return new;
end $$;
drop trigger if exists trg_jobs_guard_security_dispatch on public.jobs;
create trigger trg_jobs_guard_security_dispatch before insert or update on public.jobs
  for each row execute function public.jobs_guard_security_dispatch();

-- ── 3) job_shifts ─────────────────────────────────────────────────
create or replace function public.job_shifts_guard_company() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_company uuid; v_slot_company uuid;
begin
  select company_id into v_company from public.jobs where id = new.job_id;
  if v_company is distinct from new.company_id then
    raise exception 'シフトの会社が案件の会社と一致しません';
  end if;
  if new.slot_id is not null then
    select company_id into v_slot_company from public.jyoban_slots where id = new.slot_id;
    if v_slot_company is distinct from new.company_id then
      raise exception 'シフトの勤務枠が案件の会社に属していません';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_job_shifts_guard_company on public.job_shifts;
create trigger trg_job_shifts_guard_company before insert or update on public.job_shifts
  for each row execute function public.job_shifts_guard_company();
