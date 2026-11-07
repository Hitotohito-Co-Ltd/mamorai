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
insert into persons(id, group_id, name, consent_joint_use) values
  ('0a000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000001', '田中 花子', true);
-- A社に所属する person（同意なし）
insert into persons(id, group_id, name, consent_joint_use) values
  ('0a000000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000001', '山田 一郎', false);
-- B社に所属する person
insert into persons(id, group_id, name, consent_joint_use) values
  ('0a000000-0000-0000-0000-000000000003', 'bb000000-0000-0000-0000-000000000002', '佐藤 二郎', true);

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

grant select on companies, app_profiles, groups, persons, staff to authenticated;
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

reset role;

-- ── 結果出力 ──
select n || '. ' || case when ok then 'PASS' else 'FAIL' end || '  ' || name
  || case when not ok and detail <> '' then '  [' || detail || ']' else '' end
from t_rls_results
order by n;
