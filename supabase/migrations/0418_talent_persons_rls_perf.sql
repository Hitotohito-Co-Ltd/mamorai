-- 0418_talent_persons_rls_perf.sql — 性能報告（Sprint 8 の P-1）への対応
-- 内容: persons の会社管理者向けの参照ポリシーを、行ごとに関数を呼ぶ形から、自社の person の集合を1回だけ求める形に変える。
--   0413 の persons_company_read は app_company_has_person(id) を persons の全行で呼ぶため、1万件で約350ms かかっていた。
--   自社の person の id を返す SECURITY DEFINER の関数（staff の FORCE RLS の影響を受けない）を、集合として1回だけ評価する。
-- 安全・冪等: CREATE OR REPLACE FUNCTION、DROP POLICY IF EXISTS→CREATE POLICY のみ。見える範囲（自社に雇用がある人）は変えない。
-- 依存: 0413（app_company_has_person は他で使われる可能性があるため残す）

create or replace function public.app_company_person_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select s.person_id from public.staff s
   where s.company_id = public.app_company_id() and s.person_id is not null;
$$;
revoke all on function public.app_company_person_ids() from public;
revoke all on function public.app_company_person_ids() from anon;
grant execute on function public.app_company_person_ids() to authenticated;

drop policy if exists persons_company_read on public.persons;
create policy persons_company_read on public.persons for select
  using (id in (select public.app_company_person_ids()));
