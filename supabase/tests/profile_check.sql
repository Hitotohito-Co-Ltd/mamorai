-- 0414_worker_profile の検証シナリオ（run_jyoban_rls_check.sh から実行）。各行 PASS/FAIL を出力する。
-- 前提: 0400〜0414 適用済み、jyoban_supabase_stub.sql 適用済み。氏名はすべて架空。
create table if not exists auth.users(id uuid primary key, email text);
insert into auth.users values
 ('11111111-0000-0000-0000-000000000001','admin@a.example'),
 ('11111111-0000-0000-0000-000000000002','hq@a.example'),
 ('11111111-0000-0000-0000-000000000003','branch@a.example'),
 ('11111111-0000-0000-0000-000000000004','edu@a.example'),
 ('22222222-0000-0000-0000-000000000001','admin@b.example');
insert into companies(id,name,code) values
 ('a0000000-0000-0000-0000-00000000000a','A社','AAA-0001'),
 ('b0000000-0000-0000-0000-00000000000b','B社','BBB-0001');
insert into sites(id,name,code,company_id,report_token,shared_device_enabled) values
 ('a1000000-0000-0000-0000-000000000001','A社 現場1','A-01','a0000000-0000-0000-0000-00000000000a','tokenA1xxxxxxxxxxxxxxxxx',false),
 ('a2000000-0000-0000-0000-000000000002','A社 現場2','A-02','a0000000-0000-0000-0000-00000000000a','tokenA2xxxxxxxxxxxxxxxxx',false),
 ('b1000000-0000-0000-0000-000000000001','B社 現場1','B-01','b0000000-0000-0000-0000-00000000000b','tokenB1xxxxxxxxxxxxxxxxx',false);
insert into app_site_credentials(company_code,site_code,pin_hash,site_id,company_id,site_name) values
 ('AAA-0001','A-01',extensions.crypt('2468',extensions.gen_salt('bf')),'a1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','A社 現場1');
insert into staff(id,company_id,staff_no,name,pin_hash,is_active,site_id) values
 ('5a000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','90001','試験 一郎',extensions.crypt('1234',extensions.gen_salt('bf')),true,'a1000000-0000-0000-0000-000000000001'),
 ('5a000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a','90002','試験 二郎',extensions.crypt('5678',extensions.gen_salt('bf')),true,'a1000000-0000-0000-0000-000000000001'),
 ('5a000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-00000000000a','90003','試験 三郎',extensions.crypt('1357',extensions.gen_salt('bf')),true,'a1000000-0000-0000-0000-000000000001'),
 ('5b000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000b','90001','他社 太郎',extensions.crypt('1111',extensions.gen_salt('bf')),true,'b1000000-0000-0000-0000-000000000001');
-- 現在時刻(JST)の1時間後に始まる勤務枠（受付時間内）
insert into jyoban_slots(id,company_id,site_id,name,work_start,work_end,onduty_required,onduty_due,offduty_required,offduty_due)
select v.id::uuid, v.cid::uuid, v.sid::uuid, '日勤', to_char(t + interval '60 minutes','HH24:MI'), to_char(t + interval '8 hours','HH24:MI'),
       true, to_char(t + interval '45 minutes','HH24:MI'), true, to_char(t + interval '8 hours','HH24:MI')
  from (select date_trunc('minute', now() at time zone 'Asia/Tokyo') t) x,
       (values ('c1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','a1000000-0000-0000-0000-000000000001'),
               ('c2000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a','a2000000-0000-0000-0000-000000000002'),
               ('cb000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000b','b1000000-0000-0000-0000-000000000001')) v(id,cid,sid);

insert into staff_sites(staff_id,site_id) values
 ('5a000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001'),
 ('5a000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000002'),
 ('5b000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001') on conflict do nothing;
insert into app_profiles(user_id,role,company_id) values
 ('11111111-0000-0000-0000-000000000001','company_admin','a0000000-0000-0000-0000-00000000000a'),
 ('11111111-0000-0000-0000-000000000002','hq_operator','a0000000-0000-0000-0000-00000000000a'),
 ('11111111-0000-0000-0000-000000000003','company_manager','a0000000-0000-0000-0000-00000000000a'),
 ('11111111-0000-0000-0000-000000000004','education_center','a0000000-0000-0000-0000-00000000000a'),
 ('22222222-0000-0000-0000-000000000001','company_admin','b0000000-0000-0000-0000-00000000000b');
insert into app_profile_sites(user_id,site_id,company_id) values
 ('11111111-0000-0000-0000-000000000003','a2000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a');
grant select on companies, app_profiles, sites to authenticated;
create table t_r(n int, name text, ok boolean, detail text);
grant insert, select on t_r to anon, authenticated;
create table t_v(k text, v text);
grant insert, select on t_v to anon, authenticated;

-- 勤務員2人（90001=自現場A-01、90002=A-02）が本人登録し、現場PC(A-01)がログイン
set role anon;
do $$ declare r record; begin
  select * into r from jyoban_register_device('tokenA1xxxxxxxxxxxxxxxxx','90001','1234','ua'); insert into t_v values ('dev1', r.device_secret);
  select * into r from jyoban_register_device('tokenA2xxxxxxxxxxxxxxxxx','90002','5678','ua'); insert into t_v values ('dev2', r.device_secret);
  select * into r from app_site_open_session('AAA-0001','A-01','2468','受付PC'); insert into t_v values ('sess', r.session_token);
end $$;
-- 1 本人が基本情報を保存できる（架空の値）
do $$ begin
  perform worker_profile_save((select v from t_v where k='dev1'), 'しけん いちろう', '100-0001', '架空県架空市1-2-3', '09012345678');
  insert into t_r values (1,'本人が基本情報を保存できる', (worker_profile_get((select v from t_v where k='dev1'))->>'furigana') = 'しけん いちろう', '');
exception when others then insert into t_r values (1,'本人が基本情報を保存できる', false, sqlerrm); end $$;
-- 2 形式が不正な電話・郵便番号は拒否
do $$ declare n int := 0; begin
  begin perform worker_profile_save((select v from t_v where k='dev1'), null, null, null, '123'); exception when others then n := n + 1; end;
  begin perform worker_profile_save((select v from t_v where k='dev1'), null, '12', null, null); exception when others then n := n + 1; end;
  insert into t_r values (2,'不正な電話・郵便番号は拒否', n = 2, n::text);
end $$;
-- 3 資格・教育・健診の記録を保存、期限が取得日より前は拒否
do $$ declare id uuid; n int := 0; begin
  id := worker_credential_save((select v from t_v where k='dev1'), null, 'shinnin', '新任教育', date '2026-01-10', date '2027-01-09');
  insert into t_v values ('cred1', id::text);
  begin perform worker_credential_save((select v from t_v where k='dev1'), null, 'kenshin', '健診', date '2026-05-01', date '2026-04-01'); exception when others then n := n + 1; end;
  begin perform worker_credential_save((select v from t_v where k='dev1'), null, 'ぬる', null, null, null); exception when others then n := n + 1; end;
  insert into t_r values (3,'記録を保存でき、不正な日付・種類は拒否', id is not null and n = 2, n::text);
end $$;
-- 4 顔写真と証書の画像を保存できる（1x1 の PNG）
do $$ declare png text := 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='; begin
  perform worker_image_save((select v from t_v where k='dev1'), 'face', null, 'image/png', png);
  perform worker_image_save((select v from t_v where k='dev1'), 'credential', (select v from t_v where k='cred1')::uuid, 'image/png', png);
  insert into t_r values (4,'顔写真と証書の画像を保存できる',
    (worker_profile_get((select v from t_v where k='dev1'))->>'has_face')::boolean
    and decode(worker_image_get((select v from t_v where k='dev1'),'face') ->> 'base64', 'base64') = decode(png, 'base64')
    and (worker_image_get((select v from t_v where k='dev1'),'face') ->> 'base64') not like '%'||chr(10)||'%', '');
exception when others then insert into t_r values (4,'顔写真と証書の画像を保存できる', false, sqlerrm); end $$;
-- 5 画像でない形式・他人の記録への画像は拒否
do $$ declare n int := 0; begin
  begin perform worker_image_save((select v from t_v where k='dev1'), 'face', null, 'application/pdf', 'AAAA'); exception when others then n := n + 1; end;
  begin perform worker_image_save((select v from t_v where k='dev2'), 'credential', (select v from t_v where k='cred1')::uuid, 'image/png', 'AAAA'); exception when others then n := n + 1; end;
  insert into t_r values (5,'画像以外・他人の記録への画像は拒否', n = 2, n::text);
end $$;
-- 6 他人の記録は編集・削除できない
do $$ declare n int := 0; begin
  begin perform worker_credential_save((select v from t_v where k='dev2'), (select v from t_v where k='cred1')::uuid, 'shinnin', '改ざん', null, null); exception when others then n := n + 1; end;
  perform worker_credential_delete((select v from t_v where k='dev2'), (select v from t_v where k='cred1')::uuid);
  insert into t_r values (6,'他人の記録は編集・削除できない', n = 1 and jsonb_array_length(worker_profile_get((select v from t_v where k='dev1'))->'credentials') = 1, n::text);
end $$;
-- 7 本人以外（端末シークレットなし）は取得できない
do $$ begin
  perform worker_profile_get('x');
  insert into t_r values (7,'端末シークレットなしは取得できない', false, 'ok?');
exception when others then insert into t_r values (7,'端末シークレットなしは取得できない', true, sqlerrm); end $$;
-- 8 表を直接は読めない
do $$ begin
  perform 1 from staff_images limit 1;
  insert into t_r values (8,'表を直接は読めない', false, 'ok?');
exception when others then insert into t_r values (8,'表を直接は読めない', sqlstate = '42501', sqlerrm); end $$;
-- 9 現場PCは自現場の勤務員だけ（他現場の勤務員は不可）、画像も見られる
do $$ declare n int := 0; begin
  begin perform sitepc_staff_profile((select v from t_v where k='sess'), '90002'); exception when others then n := n + 1; end;
  insert into t_r values (9,'現場PCは自現場の勤務員の情報と画像を見られる（他現場は不可）',
    n = 1 and (sitepc_staff_profile((select v from t_v where k='sess'), '90001')->>'address') = '架空県架空市1-2-3'
    and (sitepc_staff_image((select v from t_v where k='sess'), '90001', 'face') ->> 'mime') = 'image/png', n::text);
end $$;
reset role;
-- 10 現場PCが見た記録が残る
do $$ begin
  insert into t_r values (10,'現場PCが見たら記録が残る', (select count(*) from staff_profile_views where viewer_kind='site' and staff_id='5a000000-0000-0000-0000-000000000001') = 2, '');
end $$;
-- 11〜15 会社アカウント
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000002', false);
do $$ begin
  insert into t_r values (11,'本社PCは会社の全勤務員を見られ、記録が残る',
    (company_staff_profile('90001')->>'name') = '試験 一郎' and (company_staff_profile('90002')->>'name') = '試験 二郎'
    and (company_staff_image('90001','face') ->> 'mime') = 'image/png', '');
exception when others then insert into t_r values (11,'本社PCは会社の全勤務員を見られ、記録が残る', false, sqlerrm); end $$;
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000003', false);
do $$ declare n int := 0; begin
  begin perform company_staff_profile('90001'); exception when others then n := n + 1; end;
  insert into t_r values (12,'支店は担当現場の勤務員だけ', n = 1 and (company_staff_profile('90002')->>'name') = '試験 二郎', n::text);
exception when others then insert into t_r values (12,'支店は担当現場の勤務員だけ', false, sqlerrm); end $$;
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000004', false);
do $$ begin
  perform company_staff_profile('90001');
  insert into t_r values (13,'教育センターは見られない', false, 'ok?');
exception when others then insert into t_r values (13,'教育センターは見られない', sqlerrm like '%見られる勤務員ではありません%', sqlerrm); end $$;
select set_config('request.jwt.claim.sub', '22222222-0000-0000-0000-000000000001', false);
do $$ begin
  perform company_staff_profile('90001');
  insert into t_r values (14,'他社の管理者には見えない（同じスタッフNoでも自社の勤務員だけ）', (company_staff_profile('90001')->>'name') = '他社 太郎', '');
exception when others then insert into t_r values (14,'他社の管理者には見えない（同じスタッフNoでも自社の勤務員だけ）', false, sqlerrm); end $$;
reset role;
set role anon;
do $$ begin
  perform company_staff_profile('90001');
  insert into t_r values (15,'anon は会社の画面から見られない', false, 'ok?');
exception when others then insert into t_r values (15,'anon は会社の画面から見られない', sqlstate = '42501', sqlerrm); end $$;
reset role;
do $$ begin
  insert into t_r values (16,'本社・支店の閲覧が記録される（本人以外の閲覧は全件）',
    (select count(*) from staff_profile_views where viewer_kind='hq') >= 4, '');
end $$;

select n||'. '||case when ok then 'PASS' else 'FAIL' end||'  '||name||case when ok then '' else '  ['||left(coalesce(detail,''),200)||']' end from t_r order by n;
