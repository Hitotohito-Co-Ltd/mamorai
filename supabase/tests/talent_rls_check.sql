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
-- (権限はハーネスが設定する Supabase 既定の ALTER DEFAULT PRIVILEGES に任せる。ここで付け直すとマイグレーションの revoke を打ち消すため付与しない)
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
-- (権限はハーネスが設定する Supabase 既定の ALTER DEFAULT PRIVILEGES に任せる。ここで付け直すとマイグレーションの revoke を打ち消すため付与しない)
-- (権限はハーネスが設定する Supabase 既定の ALTER DEFAULT PRIVILEGES に任せる。ここで付け直すとマイグレーションの revoke を打ち消すため付与しない)

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
  set local role postgres;  -- トリガの検査は所有者の立場で確かめる（authenticated には応募への書き込み権限が無い）
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
-- (権限はハーネスが設定する Supabase 既定の ALTER DEFAULT PRIVILEGES に任せる。ここで付け直すとマイグレーションの revoke を打ち消すため付与しない)
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
-- ── シナリオ 33〜42: Adversary 第4回（FIND-404）。変異に耐える検証と、wage・確認日の検証 ──
reset role;
-- B社の案件のシフト、NULL の会社の現場、applied の応募を持つ案件
insert into job_shifts(id, job_id, company_id, work_date, start_time, end_time, headcount) values
  ('f0000000-0000-0000-0000-00000000000c', 'e0000000-0000-0000-0000-00000000000b', 'cc000000-0000-0000-0000-000000000022', current_date, '09:00', '17:00', 1);
insert into sites(id, name, code, company_id) values ('50000000-0000-0000-0000-0000000000f0', '会社なしの現場', 'S-NULL', null);
insert into jobs(id, company_id, role_id, title, form) values
  ('e0000000-0000-0000-0000-0000000000d1', 'cc000000-0000-0000-0000-000000000011', 'd0000000-0000-0000-0000-00000000000a', '応募中の案件', 'security');
insert into job_shifts(id, job_id, company_id, work_date, start_time, end_time, headcount) values
  ('f0000000-0000-0000-0000-0000000000d1', 'e0000000-0000-0000-0000-0000000000d1', 'cc000000-0000-0000-0000-000000000011', current_date, '09:00', '17:00', 1);
insert into job_applications(company_id, job_shift_id, staff_id, status) values
  ('cc000000-0000-0000-0000-000000000011', 'f0000000-0000-0000-0000-0000000000d1', '0b000000-0000-0000-0000-000000000001', 'applied');
set role authenticated;
set request.jwt.claim.sub = '0c000000-0000-0000-0000-000000000011';  -- A社管理者

-- 33: シフトの支払単価に負の値は入れられない
do $$ begin
  begin
    insert into job_shifts(job_id, company_id, work_date, start_time, end_time, headcount, wage)
      values ('e0000000-0000-0000-0000-00000000000a', 'cc000000-0000-0000-0000-000000000011', current_date, '09:00', '17:00', 1, -1);
    insert into t_rls_results values (33, '負の支払単価のシフトは登録できない', false, '登録できてしまった');
  exception when check_violation then insert into t_rls_results values (33, '負の支払単価のシフトは登録できない', true, sqlerrm);
  end; end $$;
-- 34: 線引きの確認日が未来の案件は公開できない
do $$ begin
  begin
    insert into jobs(company_id, title, form, status, needs_boundary_check, boundary_confirmed_by, boundary_confirmed_on)
      values ('cc000000-0000-0000-0000-000000000011', '未来の確認日', 'spot', 'published', true, '山田', current_date + 1);
    insert into t_rls_results values (34, '線引きの確認日が未来の案件は公開できない', false, '公開できてしまった');
  exception when others then insert into t_rls_results values (34, '線引きの確認日が未来の案件は公開できない', sqlerrm like '%確認日%', sqlerrm);
  end; end $$;
-- 35: 線引きの確認日が空(NULL)で確認者だけある案件は公開できない
do $$ begin
  begin
    insert into jobs(company_id, title, form, status, needs_boundary_check, boundary_confirmed_by)
      values ('cc000000-0000-0000-0000-000000000011', '確認日なし', 'spot', 'published', true, '山田');
    insert into t_rls_results values (35, '確認日が空の線引き確認では公開できない', false, '公開できてしまった');
  exception when others then insert into t_rls_results values (35, '確認日が空の線引き確認では公開できない', sqlerrm like '%線引き%', sqlerrm);
  end; end $$;
-- 36: 有効な線引き確認(確認者あり・確認日が今日)なら公開できる(対になる正常系)
do $$ begin
  begin
    insert into jobs(company_id, title, form, status, needs_boundary_check, boundary_confirmed_by, boundary_confirmed_on)
      values ('cc000000-0000-0000-0000-000000000011', '有効な確認', 'spot', 'published', true, '山田', current_date);
    insert into t_rls_results values (36, '有効な線引き確認なら公開できる', true, '');
  exception when others then insert into t_rls_results values (36, '有効な線引き確認なら公開できる', false, sqlerrm);
  end; end $$;
-- 37: 自社のスタッフでも、他社のシフトへの応募は作れない
do $$ begin
  set local role postgres;  -- トリガの検査は所有者の立場で確かめる
  begin
    insert into job_applications(company_id, job_shift_id, staff_id)
      values ('cc000000-0000-0000-0000-000000000011', 'f0000000-0000-0000-0000-00000000000c', '0b000000-0000-0000-0000-000000000002');
    insert into t_rls_results values (37, '自社のスタッフでも他社のシフトへの応募は作れない', false, '作れてしまった');
  exception when others then insert into t_rls_results values (37, '自社のスタッフでも他社のシフトへの応募は作れない', sqlerrm like '%応募の会社%', sqlerrm);
  end; end $$;
-- 38: 他グループの職種・グループは参照できない
insert into t_rls_results select 38, '他グループの職種は見えない', count(*) = 0, count(*)::text || ' 件見えた' from job_roles where group_id = 'bb000000-0000-0000-0000-000000000002';
insert into t_rls_results select 39, '他グループのグループ行は見えない', count(*) = 0, count(*)::text || ' 件見えた' from groups where id = 'bb000000-0000-0000-0000-000000000002';
-- 40: 負の請求単価は登録できない
do $$ begin
  begin
    insert into jobs(company_id, title, form, billing_rate) values ('cc000000-0000-0000-0000-000000000011', '負の請求', 'spot', -1);
    insert into t_rls_results values (40, '負の請求単価は登録できない', false, '登録できてしまった');
  exception when check_violation then insert into t_rls_results values (40, '負の請求単価は登録できない', true, sqlerrm);
  end; end $$;
-- 41: 会社が未設定の現場を指す案件は登録できない
do $$ begin
  begin
    insert into jobs(company_id, site_id, title, form) values ('cc000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-0000000000f0', '会社なしの現場', 'spot');
    insert into t_rls_results values (41, '会社が未設定の現場を指す案件は登録できない', false, '登録できてしまった');
  exception when others then insert into t_rls_results values (41, '会社が未設定の現場を指す案件は登録できない', sqlerrm like '%現場%', sqlerrm);
  end; end $$;
-- 42: applied の応募だけがある案件も削除できない
do $$ begin
  begin
    delete from jobs where id = 'e0000000-0000-0000-0000-0000000000d1';
    insert into t_rls_results values (42, '応募中(applied)の案件は削除できない', false, '削除できてしまった');
  exception when others then insert into t_rls_results values (42, '応募中(applied)の案件は削除できない', sqlerrm like '%応募%', sqlerrm);
  end; end $$;
-- 43: anon は app_company_has_person も実行できない(既定の権限付与の下で)
reset role;
insert into t_rls_results select 43, 'anon は app_company_has_person を実行できない',
  not has_function_privilege('anon', 'public.app_company_has_person(uuid)', 'EXECUTE'), 'anon の EXECUTE 権限を確認';

-- ── シナリオ 44〜: Adversary 第5回（FIND-501〜504, 506, 508）──
reset role;
-- 同じグループの別会社(A2)にだけ雇用がある同意済みの人
insert into companies(id, name, code, group_id) values ('cc000000-0000-0000-0000-000000000033', 'A2社', 'RLS-A2', 'aa000000-0000-0000-0000-000000000001');
insert into persons(id, group_id, name, consent_joint_use, consent_at) values
  ('0a000000-0000-0000-0000-000000000004', 'aa000000-0000-0000-0000-000000000001', 'A2社の人', true, now());
insert into staff(id, company_id, person_id, name, staff_no) values
  ('0b000000-0000-0000-0000-000000000004', 'cc000000-0000-0000-0000-000000000033', '0a000000-0000-0000-0000-000000000004', 'A2社の人', 'A2-001');

-- 44〜45: 中核の関数の属性（SECURITY DEFINER と search_path の固定）
insert into t_rls_results select 44, 'search_candidates は SECURITY DEFINER で search_path が固定されている',
  bool_and(prosecdef) and bool_and(proconfig::text like '%search_path=public, pg_temp%'), string_agg(proname || ':' || coalesce(proconfig::text,'null'), ' ')
  from pg_proc where proname = 'search_candidates' and pronamespace = 'public'::regnamespace;
insert into t_rls_results select 45, 'app_company_has_person は SECURITY DEFINER で search_path が固定されている',
  bool_and(prosecdef) and bool_and(proconfig::text like '%search_path=public, pg_temp%'), string_agg(proname || ':' || coalesce(proconfig::text,'null'), ' ')
  from pg_proc where proname = 'app_company_has_person' and pronamespace = 'public'::regnamespace;
-- 46: 中核3表と persons の行レベルセキュリティが有効
insert into t_rls_results select 46, '中核の表は行レベルセキュリティが有効',
  count(*) = 6 and bool_and(relrowsecurity), string_agg(relname || '=' || relrowsecurity::text, ',')
  from pg_class where relname in ('jobs','job_shifts','job_applications','persons','job_roles','groups') and relnamespace = 'public'::regnamespace;

set role authenticated;
set request.jwt.claim.sub = '0c000000-0000-0000-0000-000000000011';  -- A社管理者
-- 47: 会社をまたぐ検索(同じグループの別会社の人)ができる
insert into t_rls_results select 47, 'A社管理者の候補検索は同じグループの別会社の同意済みの人も返す',
  string_agg(name, ',' order by name) = 'A2社の人,田中 花子', string_agg(name, ',' order by name)
  from public.search_candidates('cc000000-0000-0000-0000-000000000011'::uuid);

-- 48〜51: 他社(B)の管理者は、A社の jobs / job_shifts / job_applications を読めず、変更・削除もできない
set request.jwt.claim.sub = '0c000000-0000-0000-0000-000000000022';  -- B社管理者
insert into t_rls_results select 48, 'B社管理者はA社の案件・シフト・応募を読めない',
  (select count(*) from jobs where company_id = 'cc000000-0000-0000-0000-000000000011') = 0
  and (select count(*) from job_shifts where company_id = 'cc000000-0000-0000-0000-000000000011') = 0
  and (select count(*) from job_applications where company_id = 'cc000000-0000-0000-0000-000000000011') = 0, '他社の行が見えた';
do $$
declare n1 int; n2 int; n3 int; d1 int; d2 int; d3 int;
begin
  update jobs set title = '改ざん' where company_id = 'cc000000-0000-0000-0000-000000000011'; get diagnostics n1 = row_count;
  update job_shifts set headcount = 99 where company_id = 'cc000000-0000-0000-0000-000000000011'; get diagnostics n2 = row_count;
  begin update job_applications set status = 'rejected' where company_id = 'cc000000-0000-0000-0000-000000000011'; get diagnostics n3 = row_count;
  exception when insufficient_privilege then n3 := 0; end;  -- 応募への直接書き込み権限が無い（0419）
  insert into t_rls_results values (49, 'B社管理者はA社の案件・シフト・応募を更新できない', n1 + n2 + n3 = 0, n1||','||n2||','||n3);
  begin delete from job_applications where company_id = 'cc000000-0000-0000-0000-000000000011'; get diagnostics d3 = row_count;
  exception when insufficient_privilege then d3 := 0; end;
  delete from job_shifts where company_id = 'cc000000-0000-0000-0000-000000000011'; get diagnostics d2 = row_count;
  delete from jobs where company_id = 'cc000000-0000-0000-0000-000000000011'; get diagnostics d1 = row_count;
  insert into t_rls_results values (50, 'B社管理者はA社の案件・シフト・応募を削除できない', d1 + d2 + d3 = 0, d1||','||d2||','||d3);
end $$;
do $$ begin
  begin
    insert into job_applications(company_id, job_shift_id, staff_id)
      values ('cc000000-0000-0000-0000-000000000022', 'f0000000-0000-0000-0000-00000000000a', '0b000000-0000-0000-0000-000000000003');
    insert into t_rls_results values (51, 'B社管理者はA社のシフトへ自社名義の応募を作れない', false, '作れてしまった');
  exception when others then insert into t_rls_results values (51, 'B社管理者はA社のシフトへ自社名義の応募を作れない', true, sqlerrm);
  end; end $$;

-- 52〜55: 更新の経路でも同じ検査が効く
set request.jwt.claim.sub = '0c000000-0000-0000-0000-000000000011';  -- A社管理者
do $$ begin
  begin
    insert into jobs(id, company_id, title, form, needs_boundary_check) values ('e0000000-0000-0000-0000-0000000000e1', 'cc000000-0000-0000-0000-000000000011', '下書き', 'spot', true);
    update jobs set status = 'published' where id = 'e0000000-0000-0000-0000-0000000000e1';
    insert into t_rls_results values (52, '下書きの案件は、線引き確認なしでは更新でも公開できない', false, '公開できてしまった');
  exception when others then insert into t_rls_results values (52, '下書きの案件は、線引き確認なしでは更新でも公開できない', sqlerrm like '%線引き%', sqlerrm);
  end; end $$;
do $$ begin
  begin
    update jobs set role_id = 'd0000000-0000-0000-0000-00000000000b' where id = 'e0000000-0000-0000-0000-00000000000a';
    insert into t_rls_results values (53, '案件の職種を他グループのものへ更新できない', false, '更新できてしまった');
  exception when others then insert into t_rls_results values (53, '案件の職種を他グループのものへ更新できない', sqlerrm like '%職種%', sqlerrm);
  end; end $$;
do $$ begin
  set local role postgres;  -- トリガの検査は所有者の立場で確かめる
  begin
    update job_applications set staff_id = '0b000000-0000-0000-0000-000000000003' where id = 'a1000000-0000-0000-0000-00000000000a';
    insert into t_rls_results values (54, '応募のスタッフを他社のスタッフへ付け替えられない', false, '付け替えられてしまった');
  exception when others then insert into t_rls_results values (54, '応募のスタッフを他社のスタッフへ付け替えられない', sqlerrm like '%応募の会社%', sqlerrm);
  end; end $$;
do $$ begin
  begin
    update job_shifts set job_id = 'e0000000-0000-0000-0000-00000000000b' where id = 'f0000000-0000-0000-0000-00000000000a';
    insert into t_rls_results values (55, 'シフトを他社の案件へ付け替えられない', false, '付け替えられてしまった');
  exception when others then insert into t_rls_results values (55, 'シフトを他社の案件へ付け替えられない', sqlerrm like '%シフトの会社%', sqlerrm);
  end; end $$;

-- 56〜64: 列の制約の負例
do $$ begin
  begin insert into jobs(company_id, title, form, employment_days) values ('cc000000-0000-0000-0000-000000000011', 'x', 'spot', -1);
    insert into t_rls_results values (56, '雇用日数 -1 は登録できない', false, '登録できてしまった');
  exception when check_violation then insert into t_rls_results values (56, '雇用日数 -1 は登録できない', true, sqlerrm); end;
  begin insert into jobs(company_id, title, form, hourly_wage) values ('cc000000-0000-0000-0000-000000000011', 'x', 'spot', -1);
    insert into t_rls_results values (57, '時給 -1 は登録できない', false, '登録できてしまった');
  exception when check_violation then insert into t_rls_results values (57, '時給 -1 は登録できない', true, sqlerrm); end;
  begin insert into job_shifts(job_id, company_id, work_date, start_time, end_time, headcount) values ('e0000000-0000-0000-0000-00000000000a', 'cc000000-0000-0000-0000-000000000011', current_date, '09:00', '17:00', 0);
    insert into t_rls_results values (58, '必要人数 0 のシフトは登録できない', false, '登録できてしまった');
  exception when check_violation then insert into t_rls_results values (58, '必要人数 0 のシフトは登録できない', true, sqlerrm); end;
  begin insert into job_shifts(job_id, company_id, work_date, start_time, end_time, headcount) values ('e0000000-0000-0000-0000-00000000000a', 'cc000000-0000-0000-0000-000000000011', current_date, '24:00', '17:00', 1);
    insert into t_rls_results values (59, '開始時刻 24:00 のシフトは登録できない', false, '登録できてしまった');
  exception when check_violation then insert into t_rls_results values (59, '開始時刻 24:00 のシフトは登録できない', true, sqlerrm); end;
  begin insert into job_shifts(job_id, company_id, work_date, start_time, end_time, headcount) values ('e0000000-0000-0000-0000-00000000000a', 'cc000000-0000-0000-0000-000000000011', current_date, '09:00', '24:30', 1);
    insert into t_rls_results values (60, '終了時刻 24:30 のシフトは登録できない', false, '登録できてしまった');
  exception when check_violation then insert into t_rls_results values (60, '終了時刻 24:30 のシフトは登録できない', true, sqlerrm); end;
  set local role postgres;  -- 制約の検査は所有者の立場で確かめる（authenticated には応募への書き込み権限が無い）
  begin insert into job_applications(company_id, job_shift_id, staff_id) values ('cc000000-0000-0000-0000-000000000011', 'f0000000-0000-0000-0000-00000000000a', '0b000000-0000-0000-0000-000000000001');
    insert into t_rls_results values (61, '同じシフトへ同じスタッフの応募を2件作れない', false, '作れてしまった');
  exception when unique_violation then insert into t_rls_results values (61, '同じシフトへ同じスタッフの応募を2件作れない', true, sqlerrm); end;
  begin insert into job_applications(company_id, job_shift_id, staff_id, status) values ('cc000000-0000-0000-0000-000000000011', 'f0000000-0000-0000-0000-0000000000d1', '0b000000-0000-0000-0000-000000000002', 'bogus');
    insert into t_rls_results values (62, '応募の状態に未定義の値は入れられない', false, '入ってしまった');
  exception when check_violation then insert into t_rls_results values (62, '応募の状態に未定義の値は入れられない', true, sqlerrm); end;
  begin insert into jobs(company_id, title, form) values ('cc000000-0000-0000-0000-000000000011', 'x', 'bogus');
    insert into t_rls_results values (63, '契約の形に未定義の値は入れられない', false, '入ってしまった');
  exception when check_violation then insert into t_rls_results values (63, '契約の形に未定義の値は入れられない', true, sqlerrm); end;
  begin insert into jobs(company_id, title, form, status) values ('cc000000-0000-0000-0000-000000000011', 'x', 'spot', 'bogus');
    insert into t_rls_results values (64, '案件の状態に未定義の値は入れられない', false, '入ってしまった');
  exception when check_violation then insert into t_rls_results values (64, '案件の状態に未定義の値は入れられない', true, sqlerrm); end;
end $$;

-- 65〜66: 線引き確認日の『今日』は日本時間（セッションのタイムゾーンに依存しない）(FIND-506)
set time zone 'Pacific/Pago_Pago';  -- UTC-11。日本時間より先の日付にはならない
do $$ begin
  begin
    insert into jobs(company_id, title, form, status, needs_boundary_check, boundary_confirmed_by, boundary_confirmed_on)
      values ('cc000000-0000-0000-0000-000000000011', 'JST当日', 'spot', 'published', true, '山田', (now() at time zone 'Asia/Tokyo')::date);
    insert into t_rls_results values (65, '日本時間の当日の確認日は、遅いタイムゾーンのセッションでも公開できる', true, '');
  exception when others then insert into t_rls_results values (65, '日本時間の当日の確認日は、遅いタイムゾーンのセッションでも公開できる', false, sqlerrm);
  end; end $$;
set time zone 'Pacific/Kiritimati';  -- UTC+14。日本時間より先の日付になりうる
do $$ begin
  begin
    insert into jobs(company_id, title, form, status, needs_boundary_check, boundary_confirmed_by, boundary_confirmed_on)
      values ('cc000000-0000-0000-0000-000000000011', 'JST翌日', 'spot', 'published', true, '山田', (now() at time zone 'Asia/Tokyo')::date + 1);
    insert into t_rls_results values (66, '日本時間の翌日の確認日は、進んだタイムゾーンのセッションでも公開できない', false, '公開できてしまった');
  exception when others then insert into t_rls_results values (66, '日本時間の翌日の確認日は、進んだタイムゾーンのセッションでも公開できない', sqlerrm like '%確認日%', sqlerrm);
  end; end $$;
reset time zone;

-- 67〜68: 確認者がゼロ幅文字だけ(FIND-508)
do $$ begin
  begin
    insert into jobs(company_id, title, form, status, needs_boundary_check, boundary_confirmed_by, boundary_confirmed_on)
      values ('cc000000-0000-0000-0000-000000000011', 'ゼロ幅', 'spot', 'published', true, chr(8203) || chr(65279), (now() at time zone 'Asia/Tokyo')::date);
    insert into t_rls_results values (67, 'ゼロ幅文字だけの確認者では公開できない', false, '公開できてしまった');
  exception when others then insert into t_rls_results values (67, 'ゼロ幅文字だけの確認者では公開できない', sqlerrm like '%線引き%', sqlerrm);
  end;
  begin
    insert into jobs(company_id, title, form, status, needs_boundary_check, boundary_confirmed_by, boundary_confirmed_on)
      values ('cc000000-0000-0000-0000-000000000011', '可視文字あり', 'spot', 'published', true, '山' || chr(8203) || '田', (now() at time zone 'Asia/Tokyo')::date);
    insert into t_rls_results values (68, '可視文字がある確認者は(ゼロ幅文字が混ざっても)公開できる', true, '');
  exception when others then insert into t_rls_results values (68, '可視文字がある確認者は(ゼロ幅文字が混ざっても)公開できる', false, sqlerrm);
  end; end $$;

reset role;

-- ── シナリオ 69〜78: Adversary 第6回（FIND-601/602/604）──
set role authenticated;
set request.jwt.claim.sub = '0c000000-0000-0000-0000-000000000011';  -- A社管理者
-- 69〜71: 線引き未確認の案件は、公開済み系の状態(published / filled)にできない。draft は保存できる
do $$ begin
  begin
    insert into jobs(company_id, title, form, status, needs_boundary_check) values ('cc000000-0000-0000-0000-000000000011', 'filled未確認', 'spot', 'filled', true);
    insert into t_rls_results values (69, '線引き未確認の案件は filled で保存できない', false, '保存できてしまった');
  exception when others then insert into t_rls_results values (69, '線引き未確認の案件は filled で保存できない', sqlerrm like '%線引き%', sqlerrm);
  end;
  begin
    insert into jobs(company_id, title, form, status, needs_boundary_check) values ('cc000000-0000-0000-0000-000000000011', 'draft未確認', 'spot', 'draft', true);
    insert into t_rls_results values (70, '線引き未確認の案件も draft なら保存できる', true, '');
  exception when others then insert into t_rls_results values (70, '線引き未確認の案件も draft なら保存できる', false, sqlerrm);
  end;
  begin
    update jobs set status = 'filled' where title = 'draft未確認' and company_id = 'cc000000-0000-0000-0000-000000000011';
    insert into t_rls_results values (71, '下書きの未確認案件を filled に更新できない', false, '更新できてしまった');
  exception when others then insert into t_rls_results values (71, '下書きの未確認案件を filled に更新できない', sqlerrm like '%線引き%', sqlerrm);
  end; end $$;
-- 72〜73: 確認者が Unicode の空白(NBSP・U+202F)だけなら公開できない。可視文字があれば公開できる
do $$ begin
  begin
    insert into jobs(company_id, title, form, status, needs_boundary_check, boundary_confirmed_by, boundary_confirmed_on)
      values ('cc000000-0000-0000-0000-000000000011', 'NBSP', 'spot', 'published', true, chr(160), (now() at time zone 'Asia/Tokyo')::date);
    insert into t_rls_results values (72, 'NBSP だけの確認者では公開できない', false, '公開できてしまった');
  exception when others then insert into t_rls_results values (72, 'NBSP だけの確認者では公開できない', sqlerrm like '%線引き%', sqlerrm);
  end;
  begin
    insert into jobs(company_id, title, form, status, needs_boundary_check, boundary_confirmed_by, boundary_confirmed_on)
      values ('cc000000-0000-0000-0000-000000000011', 'U202F', 'spot', 'published', true, chr(8239) || chr(12288), (now() at time zone 'Asia/Tokyo')::date);
    insert into t_rls_results values (73, 'U+202F と全角空白だけの確認者では公開できない', false, '公開できてしまった');
  exception when others then insert into t_rls_results values (73, 'U+202F と全角空白だけの確認者では公開できない', sqlerrm like '%線引き%', sqlerrm);
  end;
  begin
    insert into jobs(company_id, title, form, status, needs_boundary_check, boundary_confirmed_by, boundary_confirmed_on)
      values ('cc000000-0000-0000-0000-000000000011', '可視+NBSP', 'spot', 'published', true, '山' || chr(160) || '田', (now() at time zone 'Asia/Tokyo')::date);
    insert into t_rls_results values (74, '可視文字がある確認者は(NBSP が混ざっても)公開できる', true, '');
  exception when others then insert into t_rls_results values (74, '可視文字がある確認者は(NBSP が混ざっても)公開できる', false, sqlerrm);
  end; end $$;
-- 75〜78: 中核3表の WITH CHECK（他社名義の書き込み）
do $$ begin
  begin
    insert into jobs(company_id, title, form) values ('cc000000-0000-0000-0000-000000000022', 'B社名義', 'spot');
    insert into t_rls_results values (75, 'A社管理者はB社名義の案件を作れない', false, '作れてしまった');
  exception when others then insert into t_rls_results values (75, 'A社管理者はB社名義の案件を作れない', sqlerrm like '%row-level security%', sqlerrm);
  end;
  begin
    update jobs set company_id = 'cc000000-0000-0000-0000-000000000022' where id = 'e0000000-0000-0000-0000-00000000000a';
    insert into t_rls_results values (76, 'A社管理者は自社の案件をB社名義に付け替えられない', false, '付け替えられてしまった');
  exception when others then insert into t_rls_results values (76, 'A社管理者は自社の案件をB社名義に付け替えられない', true, sqlerrm);  -- 拒否の主体は先に動くトリガ（RLS の WITH CHECK は INSERT のシナリオ 75 で固定）
  end;
  begin
    update job_shifts set company_id = 'cc000000-0000-0000-0000-000000000022' where id = 'f0000000-0000-0000-0000-00000000000a';
    insert into t_rls_results values (77, 'A社管理者は自社のシフトをB社名義に付け替えられない', false, '付け替えられてしまった');
  exception when others then insert into t_rls_results values (77, 'A社管理者は自社のシフトをB社名義に付け替えられない', true, sqlerrm);  -- 拒否の主体は先に動くトリガ（RLS の WITH CHECK は INSERT のシナリオ 75 で固定）
  end;
  set local role postgres;  -- トリガの検査は所有者の立場で確かめる
  begin
    update job_applications set company_id = 'cc000000-0000-0000-0000-000000000022' where id = 'a1000000-0000-0000-0000-00000000000a';
    insert into t_rls_results values (78, 'A社管理者は自社の応募をB社名義に付け替えられない', false, '付け替えられてしまった');
  exception when others then insert into t_rls_results values (78, 'A社管理者は自社の応募をB社名義に付け替えられない', true, sqlerrm);  -- 拒否の主体は先に動くトリガ（RLS の WITH CHECK は INSERT のシナリオ 75 で固定）
  end; end $$;
reset role;

-- ── シナリオ 79〜86: セキュリティ監査 SEC-001 / SEC-002（権限）──
reset role;
-- 79: 新しい6表に TRUNCATE / REFERENCES / TRIGGER の権限を anon・authenticated に与えない（全テナントの一括消去を防ぐ）
insert into t_rls_results select 79, '新テーブルの TRUNCATE・REFERENCES・TRIGGER 権限は anon/authenticated に無い',
  count(*) = 0, string_agg(r || ':' || t || ':' || p, ', ')
  from (select r, t, p from unnest(array['anon','authenticated']) r,
        unnest(array['groups','persons','job_roles','jobs','job_shifts','job_applications']) t,
        unnest(array['TRUNCATE','REFERENCES','TRIGGER']) p
        where has_table_privilege(r, 'public.' || t, p)) x;
-- 80: 応募テーブルは RPC 経由でしか書けない（anon・authenticated の INSERT/UPDATE/DELETE 権限が無い）。読み取りは RLS の下で可能
insert into t_rls_results select 80, '応募テーブルへの直接の INSERT/UPDATE/DELETE 権限は anon/authenticated に無い',
  count(*) = 0, string_agg(r || ':' || p, ', ')
  from (select r, p from unnest(array['anon','authenticated']) r, unnest(array['INSERT','UPDATE','DELETE']) p
        where has_table_privilege(r, 'public.job_applications', p)) x;
insert into t_rls_results select 81, '応募テーブルの SELECT は authenticated に残る（RLS で会社内に限る）',
  has_table_privilege('authenticated', 'public.job_applications', 'SELECT'), 'SELECT 権限';
-- 82: 実際に TRUNCATE を試みると拒否される
set role authenticated;
set request.jwt.claim.sub = '0c000000-0000-0000-0000-000000000011';
do $$ begin
  begin
    truncate public.persons cascade;
    insert into t_rls_results values (82, 'authenticated は persons を TRUNCATE できない', false, 'TRUNCATE できてしまった');
  exception when insufficient_privilege then insert into t_rls_results values (82, 'authenticated は persons を TRUNCATE できない', true, sqlerrm);
  end; end $$;
-- 83: 実際に応募を直接書き換えようとすると拒否される（同意なしのスタッフを確定にする攻撃）
do $$ begin
  begin
    update public.job_applications set status = 'confirmed', decided_by = 'CEO' where id = 'a1000000-0000-0000-0000-00000000000a';
    insert into t_rls_results values (83, 'A社管理者は応募を直接 confirmed に書き換えられない', false, '書き換えられてしまった');
  exception when insufficient_privilege then insert into t_rls_results values (83, 'A社管理者は応募を直接 confirmed に書き換えられない', true, sqlerrm);
  end; end $$;
reset role;
set role anon;
do $$ begin
  begin
    truncate public.jobs cascade;
    insert into t_rls_results values (84, 'anon は jobs を TRUNCATE できない', false, 'TRUNCATE できてしまった');
  exception when insufficient_privilege then insert into t_rls_results values (84, 'anon は jobs を TRUNCATE できない', true, sqlerrm);
  end; end $$;
reset role;

-- ── シナリオ 85〜87: セキュリティ監査 SEC-008（雇用先の会社と人のグループの一致）──
reset role;
-- 85: 他グループの人を、自グループの会社の雇用に紐づけられない（候補検索で他グループの人の個人情報を引ける経路になる）
do $$ begin
  begin
    insert into staff(id, company_id, person_id, name, staff_no)
      values ('0b000000-0000-0000-0000-0000000000f1', 'cc000000-0000-0000-0000-000000000011', '0a000000-0000-0000-0000-000000000003', '越境', 'X-1');
    insert into t_rls_results values (85, '他グループの人を自社の雇用に紐づけられない', false, '紐づけられてしまった');
  exception when others then insert into t_rls_results values (85, '他グループの人を自社の雇用に紐づけられない', sqlerrm like '%グループ%', sqlerrm);
  end; end $$;
-- 86: 既存の雇用の person_id を他グループの人に付け替えられない
do $$ begin
  begin
    update staff set person_id = '0a000000-0000-0000-0000-000000000003' where id = '0b000000-0000-0000-0000-000000000001';
    insert into t_rls_results values (86, '雇用の person_id を他グループの人に付け替えられない', false, '付け替えられてしまった');
  exception when others then insert into t_rls_results values (86, '雇用の person_id を他グループの人に付け替えられない', sqlerrm like '%グループ%', sqlerrm);
  end; end $$;
-- 87: 同じグループの人なら紐づけられる（対になる正常系）
do $$ begin
  begin
    insert into staff(id, company_id, person_id, name, staff_no)
      values ('0b000000-0000-0000-0000-0000000000f2', 'cc000000-0000-0000-0000-000000000011', '0a000000-0000-0000-0000-000000000004', '同グループ', 'X-2');
    insert into t_rls_results values (87, '同じグループの人は自社の雇用に紐づけられる', true, '');
  exception when others then insert into t_rls_results values (87, '同じグループの人は自社の雇用に紐づけられる', false, sqlerrm);
  end; end $$;

-- ── シナリオ 88〜90: セキュリティ再監査 SEC-001（既存テーブルと既定の権限）──
reset role;
-- 88: public スキーマの全テーブルで、anon・authenticated に TRUNCATE・REFERENCES・TRIGGER の権限が無い（テスト用の結果表を除く）
insert into t_rls_results select 88, '既存を含む全テーブルで anon/authenticated の TRUNCATE・REFERENCES・TRIGGER 権限が無い',
  count(*) = 0, coalesce(string_agg(r || ':' || c.relname || ':' || p, ', ' order by c.relname), '') 
  from pg_class c cross join unnest(array['anon','authenticated']) r cross join unnest(array['TRUNCATE','REFERENCES','TRIGGER']) p
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and c.relname <> 't_rls_results'
    and has_table_privilege(r, c.oid, p);
-- 89: 後から作るテーブルにも、その権限が既定で付かない（Supabase の既定の権限付与の下で）
create table public.zz_new_table(i int);
insert into t_rls_results select 89, '後から作るテーブルに anon/authenticated の TRUNCATE・REFERENCES・TRIGGER が既定で付かない',
  count(*) = 0, coalesce(string_agg(r || ':' || p, ', '), '')
  from unnest(array['anon','authenticated']) r cross join unnest(array['TRUNCATE','REFERENCES','TRIGGER']) p
  where has_table_privilege(r, 'public.zz_new_table', p);
-- 90: 通常の権限（SELECT/INSERT/UPDATE/DELETE）は取り消していない（既存システムの動作を壊さない）
insert into t_rls_results select 90, '通常の権限(SELECT/INSERT/UPDATE/DELETE)は新しいテーブルに残る',
  bool_and(has_table_privilege(r, 'public.zz_new_table', p)), 'SELECT/INSERT/UPDATE/DELETE'
  from unnest(array['anon','authenticated']) r cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;
drop table public.zz_new_table;

-- ── 結果出力 ──
select n || '. ' || case when ok then 'PASS' else 'FAIL' end || '  ' || name
  || case when not ok and detail <> '' then '  [' || detail || ']' else '' end
from t_rls_results
order by n;
