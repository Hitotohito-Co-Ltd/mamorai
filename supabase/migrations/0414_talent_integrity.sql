-- 0414_talent_integrity.sql — 人材基盤の整合性（Adversary Sprint 8 第3回の FIND-301/307/308）
-- 内容:
--   1) 応募のある案件・シフトは削除できない（応募の成立は労働契約の成立を伴うため、確定済みの記録を連鎖して消さない）
--   2) 案件の金額・日数に負の値を入れられない。派遣の案件は雇用日数が必須
--   3) 同意（consent_joint_use）が true の人は、同意日時（consent_at）が必須
-- 安全・冪等: 追加のみ（制約は名前を調べて追加、トリガは DROP TRIGGER IF EXISTS→CREATE TRIGGER、CREATE OR REPLACE FUNCTION）。
--   これらのテーブルは 0410 で作ったばかりで、既存の本番データはない前提（違反する行があれば適用が失敗して気付ける）。
-- 依存: 0410〜0413

-- ── 1) 応募のある案件・シフトの削除禁止 ─────────────────────────────
create or replace function public.job_shifts_guard_delete() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.job_applications a where a.job_shift_id = old.id) then
    raise exception '応募のあるシフトは削除できません（案件は状態を closed にして終了してください）';
  end if;
  return old;
end $$;
drop trigger if exists trg_job_shifts_guard_delete on public.job_shifts;
create trigger trg_job_shifts_guard_delete before delete on public.job_shifts
  for each row execute function public.job_shifts_guard_delete();

create or replace function public.jobs_guard_delete() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (
    select 1 from public.job_applications a
      join public.job_shifts s on s.id = a.job_shift_id
     where s.job_id = old.id
  ) then
    raise exception '応募のある案件は削除できません（状態を closed にして終了してください）';
  end if;
  return old;
end $$;
drop trigger if exists trg_jobs_guard_delete on public.jobs;
create trigger trg_jobs_guard_delete before delete on public.jobs
  for each row execute function public.jobs_guard_delete();

-- ── 2) 金額・日数 ──────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_employment_days_nonneg') then
    alter table public.jobs add constraint jobs_employment_days_nonneg
      check (employment_days is null or employment_days >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'jobs_hourly_wage_nonneg') then
    alter table public.jobs add constraint jobs_hourly_wage_nonneg
      check (hourly_wage is null or hourly_wage >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'jobs_billing_rate_nonneg') then
    alter table public.jobs add constraint jobs_billing_rate_nonneg
      check (billing_rate is null or billing_rate >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'jobs_dispatch_needs_days') then
    alter table public.jobs add constraint jobs_dispatch_needs_days
      check (form <> 'dispatch' or employment_days is not null);
  end if;
  -- ── 3) 同意の整合 ──
  if not exists (select 1 from pg_constraint where conname = 'persons_consent_needs_at') then
    alter table public.persons add constraint persons_consent_needs_at
      check (not consent_joint_use or consent_at is not null);
  end if;
end $$;
