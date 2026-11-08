-- 0420_talent_staff_person_group.sql — セキュリティ監査 Sprint 8 の SEC-008（Medium）
-- 背景: staff.person_id は、雇用先の会社と人のグループが一致するかを DB が検査せず、他グループの人を自社の雇用に紐づけると、
--   persons の参照ポリシー・候補検索を通じて、他グループの人の個人情報を引ける経路になる。
-- 内容: staff の person_id が、雇用先の会社（company_id）と同じグループの人でなければ拒否するトリガを追加する。
--   person_id が NULL の既存の雇用は検査しない（従来どおり）。会社の group_id が未設定の場合は、人を紐づけられない。
-- 安全・冪等: 追加のみ（CREATE OR REPLACE FUNCTION、DROP TRIGGER IF EXISTS→CREATE TRIGGER）。staff の列・データは変えない。
-- 依存: 0410（persons, companies.group_id, staff.person_id）

create or replace function public.staff_guard_person_group() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_person_group uuid; v_company_group uuid;
begin
  if new.person_id is null then
    return new;
  end if;
  select group_id into v_person_group from public.persons where id = new.person_id;
  select group_id into v_company_group from public.companies where id = new.company_id;
  if v_person_group is null or v_company_group is distinct from v_person_group then
    raise exception '人と雇用先の会社が同じグループに属していません';
  end if;
  return new;
end $$;
drop trigger if exists trg_staff_guard_person_group on public.staff;
create trigger trg_staff_guard_person_group before insert or update of person_id, company_id on public.staff
  for each row execute function public.staff_guard_person_group();
