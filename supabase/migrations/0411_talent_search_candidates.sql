-- 0411_talent_search_candidates.sql — グループ横断の候補検索（REQ-035）
-- 内容: 呼んだ会社と同じグループで、共同利用に同意した人（consent_joint_use = true）だけを返す関数。
--   同意のない人は、この関数の結果に出ない（自社の一覧は persons の RLS で別に読める）。
-- 安全・冪等: 追加のみ（CREATE OR REPLACE FUNCTION）。テーブル・列は変えない。
-- 権限: 呼べるのは、p_company_id が自分の会社のとき（会社に属する認証ユーザー。ロールは見ない。仕様 KR-5）か、運営（platform_admin）。
-- 依存: 0400（app_is_platform, app_company_id）, 0410（groups, persons, companies.group_id）
-- p_filter は将来の絞り込み用。今回は使わない（空でよい）。

create or replace function public.search_candidates(p_company_id uuid, p_filter jsonb default '{}'::jsonb)
returns table(person_id uuid, name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.app_is_platform() or p_company_id = public.app_company_id()) then
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
grant execute on function public.search_candidates(uuid, jsonb) to authenticated;
