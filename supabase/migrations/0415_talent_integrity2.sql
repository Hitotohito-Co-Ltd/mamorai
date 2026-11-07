-- 0415_talent_integrity2.sql — Adversary Sprint 8 第4回の指摘（FIND-404 ほか）
-- 内容:
--   1) シフトの支払単価（job_shifts.wage）に負の値を入れられない
--   2) 線引き確認の確認日が今日より後の案件は公開できない（確認の記録は過去・当日のものだけ）
-- 安全・冪等: 追加のみ（制約は名前を調べて追加、CREATE OR REPLACE FUNCTION、DROP TRIGGER IF EXISTS→CREATE TRIGGER）。
-- 依存: 0410〜0414（jobs_guard_security_dispatch は 0413 の版に確認日の検証を足したもの）

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'job_shifts_wage_nonneg') then
    alter table public.job_shifts add constraint job_shifts_wage_nonneg
      check (wage is null or wage >= 0);
  end if;
end $$;

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
  if new.status = 'published' and coalesce(new.needs_boundary_check, false) then
    if coalesce(btrim(new.boundary_confirmed_by), '') = '' or new.boundary_confirmed_on is null then
      raise exception '運営枠と警備枠の線引きの確認（確認者と確認日）が無い案件は公開できません';
    end if;
    if new.boundary_confirmed_on > current_date then
      raise exception '線引きの確認日が今日より後です。確認日は確認した日を入力してください';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_jobs_guard_security_dispatch on public.jobs;
create trigger trg_jobs_guard_security_dispatch before insert or update on public.jobs
  for each row execute function public.jobs_guard_security_dispatch();
