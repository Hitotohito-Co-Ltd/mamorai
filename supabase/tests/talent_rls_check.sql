-- 0410_talent_foundation の RLS / 関数 検証シナリオ（run_talent_rls_check.sh から実行）。
-- 各シナリオは PASS/FAIL 行を出力する。
-- 検証する観点:
--   1. 他社の管理者が他社の雇用の person を読めない
--   2. 運営（app_is_platform）は全件読める
--   3. 自社の一覧には同意なしの person も出る（同意は横断・他社利用の条件）
--   4. グループ横断の候補検索 search_candidates 関数の存在確認（未実装なら FAIL）

-- ── シードデータ ──────────────────────────────────────────────
insert into groups(id, name) values
  ('aa000000-0000-0000-0000-000000000001', 'HDグループA'),
  ('bb000000-0000-0000-0000-000000000002', 'HDグループB');

insert into companies(id, name, code, group_id) values
  ('cc000000-0000-0000-0000-000000000011', 'A社', 'RLS-A1', 'aa000000-0000-0000-0000-000000000001'),
  ('cc000000-0000-0000-0000-000000000022', 'B社', 'RLS-B1', 'bb000000-0000-0000-0000-000000000002');

-- A社に所属する person（同意あり）
insert into persons(id, group_id, name, consent_joint_use, consent_at) values
  ('0a000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000001', '田中 花子', true, now());
-- A社に所属する person（同意なし）
insert into persons(id, group_id, name, consent_joint_use) values
  ('0a000000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000001', '山田 一郎', false);
-- B社に所属する person
insert into persons(id, group_id, name, consent_joint_use, consent_at) values
  ('0a000000-0000-0000-0000-000000000003', 'bb000000-0000-0000-0000-000000000002', '佐藤 二郎', true, now());

-- A社に staff（雇用）を作る
insert into staff(id, company_id, person_id, name, staff_no) values
  ('0b000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000011', '0a000000-0000-0000-0000-000000000001', '田中 花子', 'A-001'),
  ('0b000000-0000-0000-0000-000000000002', 'cc000000-0000-0000-0000-000000000011', '0a000000-0000-0000-0000-000000000002', '山田 一郎', 'A-002');
-- B社に staff
insert into staff(id, company_id, person_id, name, staff_no) values
  ('0b000000-0000-0000-0000-000000000003', 'cc000000-0000-0000-0000-000000000022', '0a000000-0000-0000-0000-000000000003', '佐藤 二郎', 'B-001');

-- app_profiles（認証ユーザー）
insert into app_profiles(user_id, role, company_id) values
  -- A社 管理者
  ('0c000000-0000-0000-0000-000000000011', 'company_admin', 'cc000000-0000-0000-0000-000000000011'),
  -- B社 管理者
  ('0c000000-0000-0000-0000-000000000022', 'company_admin', 'cc000000-0000-0000-0000-000000000022'),
  -- 運営（platform）
  ('0c000000-0000-0000-0000-000000000099', 'platform_admin', null);

-- Supabase の既定に合わせ、anon / authenticated に全権限を付与する。以降の拒否は RLS とトリガだけで成り立つこと(権限の未付与で通ったように見せない)
grant all on all tables in schema public to anon, authenticated;
create table t_rls_results(n int, name text, ok boolean, detail text);
grant insert, select on t_rls_results to authenticated, anon;

-- ── シナリオ 1: 他社管理者が他社の雇用の person を読めない ──
set role authenticated;
set request.jwt.claim.sub = '0c000000-0000-0000-0000-000000000022';  -- B社管理者
-- B社管理者は A社の person（pp-001, pp-002）を読めないはず
insert into t_rls_results
  select 1,
    'B社管理者は A社の person を読めない',
    count(*) = 0,
    count(*)::text || ' 件読めた'
  from persons
  where id in (
    '0a000000-0000-0000-0000-000000000001',
    '0a000000-0000-0000-0000-000000000002'
  );

-- B社管理者は自社の person（pp-003）だけ読める
insert into t_rls_results
  select 2,
    'B社管理者は自社の person を 1 件読める',
    count(*) = 1,
    string_agg(name, ',')
  from persons
  where id = '0a000000-0000-0000-0000-000000000003';

-- ── シナリオ 2: 運営（platform_admin）は全件読める ──
set request.jwt.claim.sub = '0c000000-0000-0000-0000-000000000099';  -- 運営
-- 運営として全員の person が見えるか（3件）
-- 注意: app_is_platform() は app_profiles の role='platform_admin' で判定する想定
insert into t_rls_results
  select 3,
    '運営は全 person 3 件を読める',
    count(*) = 3,
    count(*)::text || ' 件読めた'
  from persons
  where id in (
    '0a000000-0000-0000-0000-000000000001',
    '0a000000-0000-0000-0000-000000000002',
    '0a000000-0000-0000-0000-000000000003'
  );

-- ── シナリオ 3: 自社一覧には同意なしの person も含まれる ──
set request.jwt.claim.sub = '0c000000-0000-0000-0000-000000000011';  -- A社管理者
-- A社管理者から見て A社の person（同意あり pp-001 + 同意なし pp-002）が両方見える
insert into t_rls_results
  select 4,
    'A社管理者は自社の同意なし person も一覧に出る',
    count(*) = 2,
    string_agg(name || '(consent=' || consent_joint_use::text || ')', ', ')
  from persons
  where id in (
    '0a000000-0000-0000-0000-000000000001',
    '0a000000-0000-0000-0000-000000000002'
  );

-- 同意なしの person のみ確認
insert into t_rls_results
  select 5,
    'A社管理者は同意なし person（山田）を自社一覧で読める',
    count(*) = 1,
    string_agg(name, ',')
  from persons
  where id = '0a000000-0000-0000-0000-000000000002'
    and consent_joint_use = false;

-- ── シナリオ 4: search_candidates 関数の存在確認（未実装なら FAIL） ──
-- 仕様 REQ-035 で「候補検索は同意済みの人だけを返すサーバ側の関数で行う」とされているが、
-- 関数名が仕様書に明記されておらず TDD-Writer が `search_candidates` と仮定した。
-- この関数が存在しなければ FAIL であることを確認する（Planner への差し戻し事項）。
do $$
declare
  fn_exists boolean;
begin
  select exists(
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'search_candidates'
  ) into fn_exists;
  if fn_exists then
    insert into t_rls_results values (6, 'search_candidates 関数が存在する', true, '');
  else
    insert into t_rls_results values (6, 'search_candidates 関数が存在しない（REQ-035 未実装）', false, '関数名が仕様書に未確定。Plannerへの差し戻し事項。');
  end if;
end $$;

-- ── シナリオ 7〜9: search_candidates の振る舞い（契約: 同じグループで consent_joint_use=true のみ返す）──
-- 関数が無いうちは、呼び出しの失敗を FAIL として記録する。
set role authenticated;
set request.jwt.claim.sub = '0c000000-0000-0000-0000-000000000011';  -- A社管理者
do $$
declare names text;
begin
  begin
    select string_agg(name, ',' order by name) into names
      from public.search_candidates('cc000000-0000-0000-0000-000000000011'::uuid, '{}'::jsonb);
    insert into t_rls_results values (7, 'A社管理者の候補検索は同意済み・同グループの人だけ返す(田中のみ)', names = '田中 花子', coalesce(names,'null'));
  exception when others then
    insert into t_rls_results values (7, 'A社管理者の候補検索は同意済み・同グループの人だけ返す(田中のみ)', false, sqlerrm);
  end;
end $$;
set request.jwt.claim.sub = '0c000000-0000-0000-0000-000000000022';  -- B社管理者
do $$
declare n int;
begin
  begin
    select count(*) into n from public.search_candidates('cc000000-0000-0000-0000-000000000011'::uuid, '{}'::jsonb);
    insert into t_rls_results values (8, '他社の管理者が他社の会社IDで検索すると拒否される', false, n::text || ' 件返った');
  exception when others then
    insert into t_rls_results values (8, '他社の管理者が他社の会社IDで検索すると拒否される', sqlerrm like '%権限%', sqlerrm);
  end;
end $$;
set request.jwt.claim.sub = '0c000000-0000-0000-0000-000000000011';  -- A社管理者
do $$
declare n int;
begin
  begin
    select count(*) into n from public.search_candidates('cc000000-0000-0000-0000-000000000011'::uuid);
    insert into t_rls_results values (9, 'p_filter は省略できる', n = 1, n::text || ' 件');
  exception when others then
    insert into t_rls_results values (9, 'p_filter は省略できる', false, sqlerrm);
  end;
end $$;

-- ── シナリオ 10〜16: Adversary 指摘（FIND-001/002/003/008）の越境・権限の負の経路 ──
reset role;
-- 他グループ(B)の警備職種、自グループ(A)の警備職種、B社の案件
insert into job_roles(id, group_id, name, is_security) values
  ('d0000000-0000-0000-0000-00000000000b', 'bb000000-0000-0000-0000-000000000002', '警備員B', true),
  ('d0000000-0000-0000-0000-00000000000a', 'aa000000-0000-0000-0000-000000000001', '警備員A', true);
insert into jobs(id, company_id, role_id, title, form) values
  ('e0000000-0000-0000-0000-00000000000b', 'cc000000-0000-0000-0000-000000000022', 'd0000000-0000-0000-0000-00000000000b', 'B社の案件', 'security');
grant select, insert, update on jobs, job_shifts, job_applications, job_roles to authenticated;
grant select on staff to authenticated;

set role authenticated;
-- 10: 会社に属さない認証ユーザー(app_profiles なし)は search_candidates を呼べない(FIND-001)
set request.jwt.claim.sub = '0c000000-0000-0000-0000-0000000000aa';
do $$
begin
  begin
    perform * from public.search_candidates('cc000000-0000-0000-0000-000000000011'::uuid, '{}'::jsonb);
    insert into t_rls_results values (10, '会社に属さない認証ユーザーの候補検索は拒否される', false, '拒否されなかった');
  exception when others then
    insert into t_rls_results values (10, '会社に属さない認証ユーザーの候補検索は拒否される', sqlerrm like '%権限%', sqlerrm);
  end;
end $$;

-- 11: 他グループの警備職種を指定した 警備×派遣 の案件は登録できない(FIND-002)
set request.jwt.claim.sub = '0c000000-0000-0000-0000-000000000011';  -- A社管理者
do $$
begin
  begin
    insert into jobs(company_id, role_id, title, form)
      values ('cc000000-0000-0000-0000-000000000011', 'd0000000-0000-0000-0000-00000000000b', '越境', 'dispatch');
    insert into t_rls_results values (11, '他グループの警備職種を使った警備×派遣は登録できない', false, '登録できてしまった');
  exception when others then
    insert into t_rls_results values (11, '他グループの警備職種を使った警備×派遣は登録できない', true, sqlerrm);
  end;
end $$;

-- 12: 自グループの警備職種でも 警備×派遣 は登録できない(REQ-027 のトリガ)
do $$
begin
  begin
    insert into jobs(company_id, role_id, title, form)
      values ('cc000000-0000-0000-0000-000000000011', 'd0000000-0000-0000-0000-00000000000a', '警備×派遣', 'dispatch');
    insert into t_rls_results values (12, '自グループの警備職種の警備×派遣は登録できない', false, '登録できてしまった');
  exception when others then
    insert into t_rls_results values (12, '自グループの警備職種の警備×派遣は登録できない', sqlerrm like '%派遣%', sqlerrm);
  end;
end $$;

-- 13: 他社の案件にシフトを入れられない(FIND-003)
do $$
begin
  begin
    insert into job_shifts(job_id, company_id, work_date, start_time, end_time, headcount)
      values ('e0000000-0000-0000-0000-00000000000b', 'cc000000-0000-0000-0000-000000000011', current_date, '09:00', '17:00', 1);
    insert into t_rls_results values (13, '他社の案件にシフトを入れられない', false, '入ってしまった');
  exception when others then
    insert into t_rls_results values (13, '他社の案件にシフトを入れられない', true, sqlerrm);
  end;
end $$;

-- 14: 他社のスタッフで応募を作れない(FIND-003)
reset role;
insert into jobs(id, company_id, role_id, title, form) values
  ('e0000000-0000-0000-0000-00000000000a', 'cc000000-0000-0000-0000-000000000011', 'd0000000-0000-0000-0000-00000000000a', 'A社の案件', 'security');
insert into job_shifts(id, job_id, company_id, work_date, start_time, end_time, headcount) values
  ('f0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-00000000000a', 'cc000000-0000-0000-0000-000000000011', current_date, '09:00', '17:00', 1);
set role authenticated;
set request.jwt.claim.sub = '0c000000-0000-0000-0000-000000000011';
do $$
begin
  begin
    insert into job_applications(company_id, job_shift_id, staff_id)
      values ('cc000000-0000-0000-0000-000000000011', 'f0000000-0000-0000-0000-00000000000a', '0b000000-0000-0000-0000-000000000003');  -- B社のスタッフ
    insert into t_rls_results values (14, '他社のスタッフで応募を作れない', false, '作れてしまった');
  exception when others then
    insert into t_rls_results values (14, '他社のスタッフで応募を作れない', true, sqlerrm);
  end;
end $$;

-- 15: 会社管理者は persons を作れない(登録は RPC 経由)
do $$
begin
  begin
    insert into persons(group_id, name) values ('aa000000-0000-0000-0000-000000000001', '直接登録');
    insert into t_rls_results values (15, '会社管理者は persons を直接登録できない', false, '登録できてしまった');
  exception when others then
    insert into t_rls_results values (15, '会社管理者は persons を直接登録できない', true, sqlerrm);
  end;
end $$;

-- 16: anon は search_candidates を実行できない(FIND-001 の anon 付与)
reset role;
insert into t_rls_results
  select 16, 'anon は search_candidates を実行できない',
    not has_function_privilege('anon', 'public.search_candidates(uuid, jsonb)', 'EXECUTE'),
    'anon の EXECUTE 権限を確認';

-- 17: 境界の確認が必要な案件は、記録なしでは公開(published)にできない(REQ-034 の DB 保証)
set role authenticated;
set request.jwt.claim.sub = '0c000000-0000-0000-0000-000000000011';
do $$
begin
  begin
    insert into jobs(company_id, role_id, title, form, status, needs_boundary_check)
      values ('cc000000-0000-0000-0000-000000000011', null, '整理員', 'spot', 'published', true);
    insert into t_rls_results values (17, '線引き未確認の案件は published にできない', false, '公開できてしまった');
  exception when others then
    insert into t_rls_results values (17, '線引き未確認の案件は published にできない', sqlerrm like '%線引き%', sqlerrm);
  end;
end $$;

-- 18: 公開範囲に『一般公開』は選べない(制約 jobs_audience_check)
reset role;
do $$
begin
  begin
    insert into jobs(company_id, title, form, audience)
      values ('cc000000-0000-0000-0000-000000000011', '一般公開', 'spot', 'public');
    insert into t_rls_results values (18, '公開範囲に一般公開は選べない', false, '登録できてしまった');
  exception when check_violation then
    insert into t_rls_results values (18, '公開範囲に一般公開は選べない', sqlerrm like '%audience%', sqlerrm);
  end;
end $$;

-- ── シナリオ 19〜23: Adversary 第2回（FIND-102/103/109）──
reset role;
insert into sites(id, name, code, company_id) values
  ('50000000-0000-0000-0000-00000000000a', 'A社の現場', 'S-A', 'cc000000-0000-0000-0000-000000000011'),
  ('50000000-0000-0000-0000-00000000000b', 'B社の現場', 'S-B', 'cc000000-0000-0000-0000-000000000022');
insert into jyoban_slots(id, company_id, site_id, name, work_start, work_end, departure_required, departure_due, onduty_required, grace_min, weekdays, is_active, sort_order) values
  ('51000000-0000-0000-0000-00000000000b', 'cc000000-0000-0000-0000-000000000022', '50000000-0000-0000-0000-00000000000b', 'B社の枠', '09:00', '17:00', true, '08:00', false, 5, '{1,2,3,4,5}', true, 1);
grant select, insert, update on sites, jyoban_slots to authenticated;
set role authenticated;
set request.jwt.claim.sub = '0c000000-0000-0000-0000-000000000011';  -- A社管理者

-- 19: 警備職種の案件を、職種なしの派遣に書き換えられない(FIND-102)
do $$
begin
  begin
    update jobs set role_id = null, form = 'dispatch' where id = 'e0000000-0000-0000-0000-00000000000a';
    insert into t_rls_results values (19, '警備職種の案件を職種なしの派遣に書き換えられない', false, '書き換えられた');
  exception when others then
    insert into t_rls_results values (19, '警備職種の案件を職種なしの派遣に書き換えられない', sqlerrm like '%職種%', sqlerrm);
  end;
end $$;

-- 20: 確認者が空文字の線引き確認では公開できない(FIND-103)
do $$
begin
  begin
    insert into jobs(company_id, title, form, status, needs_boundary_check, boundary_confirmed_by, boundary_confirmed_on)
      values ('cc000000-0000-0000-0000-000000000011', '整理員', 'spot', 'published', true, '', current_date);
    insert into t_rls_results values (20, '確認者が空文字の線引き確認では公開できない', false, '公開できてしまった');
  exception when others then
    insert into t_rls_results values (20, '確認者が空文字の線引き確認では公開できない', sqlerrm like '%線引き%', sqlerrm);
  end;
end $$;

-- 21: 他社の現場(site_id)を指す案件は登録できない(FIND-109)
do $$
begin
  begin
    insert into jobs(company_id, site_id, title, form)
      values ('cc000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-00000000000b', '越境の現場', 'spot');
    insert into t_rls_results values (21, '他社の現場を指す案件は登録できない', false, '登録できてしまった');
  exception when others then
    insert into t_rls_results values (21, '他社の現場を指す案件は登録できない', sqlerrm like '%現場%', sqlerrm);
  end;
end $$;

-- 22: 他社の勤務枠(slot_id)を指すシフトは登録できない(FIND-109)
do $$
begin
  begin
    insert into job_shifts(job_id, company_id, work_date, start_time, end_time, headcount, slot_id)
      values ('e0000000-0000-0000-0000-00000000000a', 'cc000000-0000-0000-0000-000000000011', current_date, '09:00', '17:00', 1, '51000000-0000-0000-0000-00000000000b');
    insert into t_rls_results values (22, '他社の勤務枠を指すシフトは登録できない', false, '登録できてしまった');
  exception when others then
    insert into t_rls_results values (22, '他社の勤務枠を指すシフトは登録できない', sqlerrm like '%勤務枠%', sqlerrm);
  end;
end $$;

-- 23: 自社の現場・勤務枠を指す案件・シフトは登録できる(対になる正常系)
do $$
begin
  begin
    insert into jobs(company_id, site_id, title, form)
      values ('cc000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-00000000000a', '自社の現場', 'spot');
    insert into t_rls_results values (23, '自社の現場を指す案件は登録できる', true, '');
  exception when others then
    insert into t_rls_results values (23, '自社の現場を指す案件は登録できる', false, sqlerrm);
  end;
end $$;

reset role;

-- ── シナリオ 24〜31: Adversary 第3回（FIND-301/307/308）──
reset role;
-- 応募のある案件(e…0a)・シフト(f…0a)・応募を用意する
insert into job_applications(id, company_id, job_shift_id, staff_id, status) values
  ('a1000000-0000-0000-0000-00000000000a', 'cc000000-0000-0000-0000-000000000011', 'f0000000-0000-0000-0000-00000000000a', '0b000000-0000-0000-0000-000000000001', 'confirmed');
set role authenticated;
set request.jwt.claim.sub = '0c000000-0000-0000-0000-000000000011';  -- A社管理者

-- 24: 応募のある案件は削除できない(FIND-307)
do $$
declare n int;
begin
  begin
    delete from jobs where id = 'e0000000-0000-0000-0000-00000000000a';
    insert into t_rls_results values (24, '応募のある案件は削除できない', false, '削除できてしまった');
  exception when others then
    insert into t_rls_results values (24, '応募のある案件は削除できない', sqlerrm like '%応募%', sqlerrm);
  end;
end $$;
-- 25: 応募のあるシフトは削除できない
do $$
begin
  begin
    delete from job_shifts where id = 'f0000000-0000-0000-0000-00000000000a';
    insert into t_rls_results values (25, '応募のあるシフトは削除できない', false, '削除できてしまった');
  exception when others then
    insert into t_rls_results values (25, '応募のあるシフトは削除できない', sqlerrm like '%応募%', sqlerrm);
  end;
end $$;
-- 26: 応募が消えていない
reset role;
insert into t_rls_results select 26, '確定済みの応募が残っている', count(*) = 1, count(*)::text || ' 件' from job_applications where id = 'a1000000-0000-0000-0000-00000000000a';
set role authenticated;
set request.jwt.claim.sub = '0c000000-0000-0000-0000-000000000011';

-- 27: 金額・日数に負の値は入れられない(FIND-308)
do $$
begin
  begin
    insert into jobs(company_id, title, form, hourly_wage) values ('cc000000-0000-0000-0000-000000000011', '負の時給', 'spot', -100);
    insert into t_rls_results values (27, '負の時給は登録できない', false, '登録できてしまった');
  exception when check_violation then
    insert into t_rls_results values (27, '負の時給は登録できない', true, sqlerrm);
  end;
end $$;
do $$
begin
  begin
    insert into jobs(company_id, title, form, employment_days) values ('cc000000-0000-0000-0000-000000000011', '負の日数', 'spot', -5);
    insert into t_rls_results values (28, '負の雇用日数は登録できない', false, '登録できてしまった');
  exception when check_violation then
    insert into t_rls_results values (28, '負の雇用日数は登録できない', true, sqlerrm);
  end;
end $$;
-- 29: 派遣の案件は雇用日数が必須(職種は有効な非警備。雇用日数だけが欠けている)
reset role;
insert into job_roles(id, group_id, name, is_security) values ('d0000000-0000-0000-0000-0000000000c1', 'aa000000-0000-0000-0000-000000000001', '受付', false);
set role authenticated;
set request.jwt.claim.sub = '0c000000-0000-0000-0000-000000000011';
do $$
begin
  begin
    insert into jobs(company_id, role_id, title, form) values ('cc000000-0000-0000-0000-000000000011', 'd0000000-0000-0000-0000-0000000000c1', '日数なしの派遣', 'dispatch');
    insert into t_rls_results values (29, '雇用日数のない派遣は登録できない', false, '登録できてしまった');
  exception when others then
    insert into t_rls_results values (29, '雇用日数のない派遣は登録できない', true, sqlerrm);
  end;
end $$;
-- 30: 雇用日数のある非警備の派遣は登録できる(対になる正常系)
do $$
begin
  begin
    insert into jobs(company_id, role_id, title, form, employment_days) values ('cc000000-0000-0000-0000-000000000011', 'd0000000-0000-0000-0000-0000000000c1', '受付の派遣', 'dispatch', 45);
    insert into t_rls_results values (30, '雇用日数のある非警備の派遣は登録できる', true, '');
  exception when others then
    insert into t_rls_results values (30, '雇用日数のある非警備の派遣は登録できる', false, sqlerrm);
  end;
end $$;
-- 31: 同意が true なのに同意日時がない person は作れない(運営でも)(FIND-301 の 035a 部分)
reset role;
do $$
begin
  begin
    insert into persons(group_id, name, consent_joint_use) values ('aa000000-0000-0000-0000-000000000001', '日時なし', true);
    insert into t_rls_results values (31, '同意ありで同意日時なしの person は作れない', false, '作れてしまった');
  exception when check_violation then
    insert into t_rls_results values (31, '同意ありで同意日時なしの person は作れない', true, sqlerrm);
  end;
end $$;
-- ── 結果出力 ──
select n || '. ' || case when ok then 'PASS' else 'FAIL' end || '  ' || name
  || case when not ok and detail <> '' then '  [' || detail || ']' else '' end
from t_rls_results
order by n;
