-- 0416_talent_boundary_jst.sql — Adversary Sprint 8 第5回の FIND-506 / FIND-508
-- 内容:
--   1) 線引き確認日の『今日』を日本時間（Asia/Tokyo）の日付にする。
--      current_date は DB セッションのタイムゾーンに依存し、Supabase の既定（UTC）では日本時間の 0〜9 時に当日の確認日を拒否してしまう
--   2) 確認者は、空白とゼロ幅文字（U+200B〜U+200D、U+2060、U+FEFF）を除いて空でないこと（TS 側の判定と同じ基準）
-- 安全・冪等: CREATE OR REPLACE FUNCTION と DROP TRIGGER IF EXISTS→CREATE TRIGGER のみ。列・データは変えない。
-- 依存: 0415（jobs_guard_security_dispatch の最新版に上の2点を反映したもの）

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
    if regexp_replace(coalesce(new.boundary_confirmed_by, ''), '[\s　​-‍⁠﻿]', '', 'g') = ''
       or new.boundary_confirmed_on is null then
      raise exception '運営枠と警備枠の線引きの確認（確認者と確認日）が無い案件は公開できません';
    end if;
    if new.boundary_confirmed_on > (now() at time zone 'Asia/Tokyo')::date then
      raise exception '線引きの確認日が今日（日本時間）より後です。確認日は確認した日を入力してください';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_jobs_guard_security_dispatch on public.jobs;
create trigger trg_jobs_guard_security_dispatch before insert or update on public.jobs
  for each row execute function public.jobs_guard_security_dispatch();
