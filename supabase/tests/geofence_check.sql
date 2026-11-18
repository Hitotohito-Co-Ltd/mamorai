-- 0412_jyoban_geofence の検証シナリオ（run_jyoban_rls_check.sh から実行）。各行 PASS/FAIL を出力する。
-- 前提: 0400〜0412 適用済み、jyoban_supabase_stub.sql 適用済み。氏名・地点はすべて架空。
insert into companies(id,name,code) values
 ('a0000000-0000-0000-0000-00000000000a','A社','AAA-0001'),
 ('b0000000-0000-0000-0000-00000000000b','B社','BBB-0001');
insert into sites(id,name,code,company_id,report_token,shared_device_enabled) values
 ('a1000000-0000-0000-0000-000000000001','A社 現場1','A-01','a0000000-0000-0000-0000-00000000000a','tokenA1xxxxxxxxxxxxxxxxx',false),
 ('a2000000-0000-0000-0000-000000000002','A社 現場2','A-02','a0000000-0000-0000-0000-00000000000a','tokenA2xxxxxxxxxxxxxxxxx',false);
insert into staff(id,company_id,staff_no,name,pin_hash,is_active,site_id) values
 ('5a000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','90001','試験 一郎',extensions.crypt('1234',extensions.gen_salt('bf')),true,'a1000000-0000-0000-0000-000000000001'),
 ('5a000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a','90002','試験 二郎',extensions.crypt('5678',extensions.gen_salt('bf')),true,'a1000000-0000-0000-0000-000000000001');
-- 現在時刻(JST)の1時間後に始まる勤務枠。起床・上番・下番あり
insert into jyoban_slots(id,company_id,site_id,name,work_start,work_end,departure_required,departure_due,onduty_required,onduty_due,
                         wakeup_required,wakeup_due,offduty_required,offduty_due)
select 'c1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','a1000000-0000-0000-0000-000000000001','日勤',
       to_char(t + interval '60 minutes','HH24:MI'), to_char(t + interval '8 hours','HH24:MI'), false, null, true, to_char(t + interval '45 minutes','HH24:MI'),
       true, to_char(t + interval '10 minutes','HH24:MI'), true, to_char(t + interval '8 hours','HH24:MI')
  from (select date_trunc('minute', now() at time zone 'Asia/Tokyo') t) x;
insert into app_profiles(user_id,role,company_id) values
 ('11111111-1111-1111-1111-111111111111','company_admin','a0000000-0000-0000-0000-00000000000a'),
 ('11111111-1111-1111-1111-222222222222','hq_operator','a0000000-0000-0000-0000-00000000000a'),
 ('22222222-2222-2222-2222-222222222222','company_admin','b0000000-0000-0000-0000-00000000000b');
grant select on companies, app_profiles to authenticated;
alter role service_role bypassrls;
grant select on all tables in schema public to service_role;

create table t_r(n int, name text, ok boolean, detail text);
grant insert, select on t_r to anon, authenticated, service_role;
create table t_secret(who text, secret text);
grant insert, select on t_secret to anon;

-- 1・2 制約
do $$ begin
  update sites set geo_mode = 'always' where id = 'a1000000-0000-0000-0000-000000000001';
  insert into t_r values (1,'位置確認の設定に不正値は入らない', false, 'ok?');
exception when others then insert into t_r values (1,'位置確認の設定に不正値は入らない', sqlstate = '23514', sqlerrm); end $$;
do $$ begin
  update sites set geo_mode = 'required', geo_lat = null, geo_lng = null where id = 'a1000000-0000-0000-0000-000000000001';
  insert into t_r values (2,'地点なしで位置確認は使えない', false, 'ok?');
exception when others then insert into t_r values (2,'地点なしで位置確認は使えない', sqlstate = '23514', sqlerrm); end $$;

-- 3〜5 設定できるのは管理者（自社）だけ
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ declare g record; begin
  perform company_set_site_geofence('a1000000-0000-0000-0000-000000000001','required',35.6790375,139.769234375,200,'MQH9+JM9 中央区、東京都');
  select * into g from company_get_site_geofence('a1000000-0000-0000-0000-000000000001');
  insert into t_r values (3,'管理者は自社の現場に地点と範囲を設定できる', g.mode = 'required' and g.radius_m = 200 and g.label like 'MQH9+JM9%', g::text);
end $$;
do $$ begin
  perform company_set_site_geofence('a1000000-0000-0000-0000-000000000001','required',null,null,200,null);
  insert into t_r values (4,'地点なしの「範囲内でのみ」は拒否', false, 'ok?');
exception when others then insert into t_r values (4,'地点なしの「範囲内でのみ」は拒否', sqlerrm like '%地点を登録%', sqlerrm); end $$;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-222222222222', false);
do $$ begin
  perform company_set_site_geofence('a1000000-0000-0000-0000-000000000001','off',null,null,200,null);
  insert into t_r values (5,'本社PCは設定を変えられない', false, 'ok?');
exception when others then insert into t_r values (5,'本社PCは設定を変えられない', sqlerrm like '%権限がありません%', sqlerrm); end $$;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin
  perform company_get_site_geofence('a1000000-0000-0000-0000-000000000001');
  insert into t_r values (6,'他社の現場の設定は見られない', false, 'ok?');
exception when others then insert into t_r values (6,'他社の現場の設定は見られない', sqlerrm like '%権限がありません%', sqlerrm); end $$;
reset role;

-- 7 未ログイン（anon）は設定RPCを呼べない
set role anon;
do $$ begin
  perform company_set_site_geofence('a1000000-0000-0000-0000-000000000001','off',null,null,200,null);
  insert into t_r values (7,'anon は設定RPCを呼べない', false, 'ok?');
exception when others then insert into t_r values (7,'anon は設定RPCを呼べない', sqlstate = '42501', sqlerrm); end $$;

do $$ declare r record; begin
  select * into r from jyoban_register_device('tokenA1xxxxxxxxxxxxxxxxx','90001','1234','test-ua'); insert into t_secret values ('one', r.device_secret);
  select * into r from jyoban_register_device('tokenA1xxxxxxxxxxxxxxxxx','90002','5678','test-ua'); insert into t_secret values ('two', r.device_secret);
end $$;

-- 8 勤務員アプリに設定が届く（使わない現場は地点を返さない）
do $$ declare a jsonb; b jsonb; begin
  a := jyoban_site_geofence('tokenA1xxxxxxxxxxxxxxxxx');
  b := jyoban_site_geofence('tokenA2xxxxxxxxxxxxxxxxx');
  insert into t_r values (8,'現場の位置確認の設定を返す（使わない現場は地点なし）',
    a->>'mode' = 'required' and (a->>'lat')::float8 between 35.67 and 35.69 and (a->>'radius_m')::int = 200
    and b->>'mode' = 'off' and b->'lat' = 'null'::jsonb, a::text || ' / ' || b::text);
end $$;

-- 9〜11 「範囲内でのみ」: 範囲外・位置なし・誤差大は上番を受け付けない
do $$ begin
  perform jyoban_submit_report('tokenA1xxxxxxxxxxxxxxxxx','c1000000-0000-0000-0000-000000000001','onduty',(select secret from t_secret where who='one'),
    p_lat => 35.6844, p_lng => 139.7692, p_accuracy_m => 20);   -- 北へ約600m
  insert into t_r values (9,'範囲外からの上番は拒否', false, 'ok?');
exception when others then insert into t_r values (9,'範囲外からの上番は拒否', sqlerrm like '現場から約%m離れています。現場（半径200m）に着いてから%', sqlerrm); end $$;
do $$ begin
  perform jyoban_submit_report('tokenA1xxxxxxxxxxxxxxxxx','c1000000-0000-0000-0000-000000000001','onduty',(select secret from t_secret where who='one'));
  insert into t_r values (10,'位置なしの上番は拒否（旧アプリからの呼び出しも）', false, 'ok?');
exception when others then insert into t_r values (10,'位置なしの上番は拒否（旧アプリからの呼び出しも）', sqlerrm like '位置を確認できないため%', sqlerrm); end $$;
do $$ begin
  perform jyoban_submit_report('tokenA1xxxxxxxxxxxxxxxxx','c1000000-0000-0000-0000-000000000001','onduty',(select secret from t_secret where who='one'),
    p_lat => 35.6790375, p_lng => 139.769234375, p_accuracy_m => 800);
  insert into t_r values (11,'誤差が大きい位置の上番は拒否', false, 'ok?');
exception when others then insert into t_r values (11,'誤差が大きい位置の上番は拒否', sqlerrm like '位置の誤差が大きすぎます%', sqlerrm); end $$;

-- 12 範囲内（誤差の分だけ広げる: 中心から約260m・誤差80m・半径200m）なら受け付ける
do $$ declare r record; begin
  select * into r from jyoban_submit_report('tokenA1xxxxxxxxxxxxxxxxx','c1000000-0000-0000-0000-000000000001','onduty',(select secret from t_secret where who='one'),
    p_lat => 35.6790375 + 260 / 111195.0, p_lng => 139.769234375, p_accuracy_m => 80);
  insert into t_r values (12,'範囲内（誤差込み）の上番は受け付ける', r.error is null and r.report_id is not null and not r.duplicate, coalesce(r.error,''));
end $$;
-- 13 起床連絡は位置確認の対象外（位置なしで送れる）
do $$ declare r record; begin
  select * into r from jyoban_submit_report('tokenA1xxxxxxxxxxxxxxxxx','c1000000-0000-0000-0000-000000000001','wakeup',(select secret from t_secret where who='one'));
  insert into t_r values (13,'起床連絡は位置確認の対象外', r.error is null and r.report_id is not null, coalesce(r.error,''));
end $$;
reset role;

-- 14 上番の位置・距離・判定が記録される／起床には残らない
do $$ declare a record; w record; begin
  select * into a from jyoban_reports where type = 'onduty' and staff_no = '90001';
  select * into w from jyoban_reports where type = 'wakeup' and staff_no = '90001';
  insert into t_r values (14,'上番の位置と判定を記録（起床は対象外）',
    a.geo_status = 'inside' and a.geo_distance_m between 250 and 270 and a.geo_accuracy_m = 80 and a.geo_lat is not null
    and w.geo_status is null and w.geo_lat is null, a.geo_status || ' ' || a.geo_distance_m || ' / ' || coalesce(w.geo_status,'null'));
end $$;

-- 15 「記録だけ」: 範囲外の下番も受け付け、範囲外として残す
update sites set geo_mode = 'record' where id = 'a1000000-0000-0000-0000-000000000001';
set role anon;
do $$ declare r record; begin
  select * into r from jyoban_submit_report('tokenA1xxxxxxxxxxxxxxxxx','c1000000-0000-0000-0000-000000000001','offduty',(select secret from t_secret where who='one'),
    p_lat => 35.6844, p_lng => 139.7692, p_accuracy_m => 20);
  insert into t_r values (15,'「記録だけ」は範囲外の下番も受け付ける', r.error is null and r.report_id is not null, coalesce(r.error,''));
end $$;
reset role;
do $$ declare a record; begin
  select * into a from jyoban_reports where type = 'offduty' and staff_no = '90001';
  insert into t_r values (16,'範囲外として記録', a.geo_status = 'outside' and a.geo_distance_m between 580 and 620, a.geo_status || ' ' || a.geo_distance_m);
end $$;

-- 17 「使わない」: 位置を送っても保存しない
update sites set geo_mode = 'off' where id = 'a1000000-0000-0000-0000-000000000001';
set role anon;
do $$ declare r record; begin
  select * into r from jyoban_submit_report('tokenA1xxxxxxxxxxxxxxxxx','c1000000-0000-0000-0000-000000000001','onduty',(select secret from t_secret where who='two'),
    p_lat => 35.6844, p_lng => 139.7692, p_accuracy_m => 20);
  insert into t_r values (17,'「使わない」現場は上番を受け付ける', r.error is null and r.report_id is not null, coalesce(r.error,''));
end $$;
reset role;
do $$ declare a record; begin
  select * into a from jyoban_reports where type = 'onduty' and staff_no = '90002';
  insert into t_r values (18,'「使わない」現場では位置を保存しない', a.geo_lat is null and a.geo_status is null, coalesce(a.geo_status,'null'));
end $$;

-- 19 判定関数が画面（input-core の judgeGeofence）と同じ境界で動く
do $$ declare a record; b record; c record; begin
  select * into a from jyoban_geo_judge('required', 35.0, 139.0, 200, 35.0 + 299 / 111195.0, 139.0, 100);  -- 299m・誤差100 → 範囲内
  select * into b from jyoban_geo_judge('required', 35.0, 139.0, 200, 35.0 + 320 / 111195.0, 139.0, 250);  -- 誤差で広げるのは100mまで
  select * into c from jyoban_geo_judge('record',   35.0, 139.0, 200, null, null, null);
  insert into t_r values (19,'判定の境界（誤差の上乗せは100mまで）',
    a.status = 'inside' and b.status = 'outside' and not b.allowed and c.status = 'no_fix' and c.allowed, a.status||' '||b.status||' '||c.status);
end $$;

select n||'. '||case when ok then 'PASS' else 'FAIL' end||'  '||name||case when ok then '' else '  ['||left(coalesce(detail,''),160)||']' end from t_r order by n;
