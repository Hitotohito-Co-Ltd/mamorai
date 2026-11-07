-- 0412_talent_hardening.sql — 人材基盤の越境・権限の穴をふさぐ（Adversary Sprint 8 の FIND-001/002/003/008）
-- 内容:
--   1) search_candidates: 会社に属さない認証ユーザー（app_company_id() が NULL）を拒否。anon の実行権限を取り消す。search_path を固定
--   2) jobs: 職種は自グループのものだけ。警備×派遣の禁止は他グループの職種でも回避できないようにトリガを SECURITY DEFINER に。
--      線引きの確認が必要な案件（needs_boundary_check）は、確認者と確認日が無ければ published にできない（REQ-034）
--   3) job_shifts / job_applications: 親（案件・シフト・スタッフ）と company_id が一致しない行を拒否（テナント越境の防止）
-- 安全・冪等: 追加のみ（ADD COLUMN IF NOT EXISTS、CREATE OR REPLACE FUNCTION、DROP TRIGGER IF EXISTS→CREATE TRIGGER）。
--   追加列は NULL 許容。既存のデータは変えない。
-- 依存: 0410, 0411

alter table public.jobs add column if not exists needs_boundary_check boolean default false;

-- ── 1) search_candidates ──────────────────────────────────────────
create or replace function public.search_candidates(p_company_id uuid, p_filter jsonb default '{}'::jsonb)
returns table(person_id uuid, name text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_company_id is null
     or not (coalesce(public.app_is_platform(), false)
             or coalesce(p_company_id = public.app_company_id(), false)) then
    raise exception '権限がありません（自社の候補検索のみ可能です）';
  end if;
  return query
    select p.id, p.name
      from public.persons p
      join public.companies c on c.group_id = p.group_id
     where c.id = p_company_id
       and p.consent_joint_use = true
     order by p.name, p.id;
end $$;

revoke all on function public.search_candidates(uuid, jsonb) from public;
revoke all on function public.search_candidates(uuid, jsonb) from anon;
grant execute on function public.search_candidates(uuid, jsonb) to authenticated;

-- ── 2) jobs ───────────────────────────────────────────────────────
create or replace function public.jobs_guard_security_dispatch() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_sec boolean; v_role_group uuid; v_company_group uuid;
begin
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
  if new.status = 'published' and coalesce(new.needs_boundary_check, false)
     and (new.boundary_confirmed_by is null or new.boundary_confirmed_on is null) then
    raise exception '運営枠と警備枠の線引きの確認（確認者と確認日）が無い案件は公開できません';
  end if;
  return new;
end $$;
drop trigger if exists trg_jobs_guard_security_dispatch on public.jobs;
create trigger trg_jobs_guard_security_dispatch before insert or update on public.jobs
  for each row execute function public.jobs_guard_security_dispatch();

-- ── 3) テナント越境の防止 ─────────────────────────────────────────
create or replace function public.job_shifts_guard_company() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_company uuid;
begin
  select company_id into v_company from public.jobs where id = new.job_id;
  if v_company is distinct from new.company_id then
    raise exception 'シフトの会社が案件の会社と一致しません';
  end if;
  return new;
end $$;
drop trigger if exists trg_job_shifts_guard_company on public.job_shifts;
create trigger trg_job_shifts_guard_company before insert or update on public.job_shifts
  for each row execute function public.job_shifts_guard_company();

create or replace function public.job_applications_guard_company() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_shift_company uuid; v_staff_company uuid;
begin
  select company_id into v_shift_company from public.job_shifts where id = new.job_shift_id;
  select company_id into v_staff_company from public.staff where id = new.staff_id;
  if v_shift_company is distinct from new.company_id or v_staff_company is distinct from new.company_id then
    raise exception '応募の会社が、シフトまたはスタッフの会社と一致しません';
  end if;
  return new;
end $$;
drop trigger if exists trg_job_applications_guard_company on public.job_applications;
create trigger trg_job_applications_guard_company before insert or update on public.job_applications
  for each row execute function public.job_applications_guard_company();
