-- 0415_staff_profile_list: 本社PC・管理者・支店の「勤務員の個人情報」画面の材料
-- 依存: 0414（staff_profiles / staff_credentials / staff_images / staff_profile_views / app_can_view_staff）。追加のみ・冪等。
--   company_list_staff()      … 見られる勤務員の一覧（顔写真の有無・記録の件数・期限切れ／更新間近の件数）。本人の中身は返さない
--   company_staff_view_log()  … 本人以外の閲覧記録（誰が・何を・いつ）。管理者だけ

create or replace function public.company_list_staff() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_company uuid := public.app_company_id(); v_today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  if v_company is null then raise exception '権限がありません'; end if;
  return coalesce((
    select jsonb_agg(x order by x->>'staff_no') from (
      select jsonb_build_object(
        'staff_no', s.staff_no, 'name', s.name, 'is_active', coalesce(s.is_active, true),
        'sites', coalesce((select jsonb_agg(st.name order by st.name)
                             from public.staff_sites ss join public.sites st on st.id = ss.site_id
                            where ss.staff_id = s.id), '[]'::jsonb),
        'has_profile', exists (select 1 from public.staff_profiles p where p.staff_id = s.id and (p.address is not null or p.furigana is not null)),
        'has_face', exists (select 1 from public.staff_images i where i.staff_id = s.id and i.kind = 'face'),
        'credential_count', (select count(*) from public.staff_credentials c where c.staff_id = s.id),
        'expired_count', (select count(*) from public.staff_credentials c where c.staff_id = s.id and c.expires_on < v_today),
        'soon_count', (select count(*) from public.staff_credentials c where c.staff_id = s.id and c.expires_on >= v_today and c.expires_on <= v_today + 30)
      ) as x
      from public.staff s
     where s.company_id = v_company and public.app_can_view_staff(s.id)
    ) q), '[]'::jsonb);
end $$;

create or replace function public.company_staff_view_log(p_staff_no text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_staff uuid;
begin
  perform public.app_require_admin();
  select s.id into v_staff from public.staff s where s.staff_no = p_staff_no and s.company_id = public.app_company_id();
  if v_staff is null then raise exception '勤務員が見つかりません'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('viewer_kind', v.viewer_kind, 'viewer', v.viewer, 'what', v.what, 'viewed_at', v.viewed_at) order by v.viewed_at desc)
      from (select * from public.staff_profile_views w where w.staff_id = v_staff order by w.viewed_at desc limit 50) v), '[]'::jsonb);
end $$;

revoke all on function public.company_list_staff() from public, anon;
revoke all on function public.company_staff_view_log(text) from public, anon;
grant execute on function public.company_list_staff() to authenticated;
grant execute on function public.company_staff_view_log(text) to authenticated;
