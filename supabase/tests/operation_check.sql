-- 0413_jyoban_operation の検証シナリオ（run_jyoban_rls_check.sh から実行）。各行 PASS/FAIL を出力する。
-- 前提: 0400〜0413 適用済み、jyoban_supabase_stub.sql 適用済み。氏名はすべて架空。
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
-- 配置者（勤務表）は 90001 だけ。90002 は勤務表外
insert into jyoban_slot_staff(slot_id,staff_id,company_id) values
 ('c1000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a');
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

-- 1・2 約定人数（曜日別7要素）の制約
do $$ begin
  update jyoban_slots set required_by_dow = '{2,2,2,2,2,2,2}' where id = 'c1000000-0000-0000-0000-000000000001';
  insert into t_r values (1,'約定人数を曜日別（7要素）で登録できる', true, '');
exception when others then insert into t_r values (1,'約定人数を曜日別（7要素）で登録できる', false, sqlerrm); end $$;
do $$ begin
  update jyoban_slots set required_by_dow = '{2,2,2}' where id = 'c1000000-0000-0000-0000-000000000001';
  insert into t_r values (2,'7要素でない約定人数は入らない', false, 'ok?');
exception when others then insert into t_r values (2,'7要素でない約定人数は入らない', sqlstate = '23514', sqlerrm); end $$;

-- 勤務員2人（配置者と勤務表外）が上番
set role anon;
do $$ declare r record; begin
  select * into r from jyoban_register_device('tokenA1xxxxxxxxxxxxxxxxx','90001','1234','ua'); insert into t_v values ('dev1', r.device_secret);
  select * into r from jyoban_register_device('tokenA1xxxxxxxxxxxxxxxxx','90002','5678','ua'); insert into t_v values ('dev2', r.device_secret);
  select * into r from jyoban_submit_report('tokenA1xxxxxxxxxxxxxxxxx','c1000000-0000-0000-0000-000000000001','onduty',(select v from t_v where k='dev1'));
  insert into t_v values ('rep1', r.report_id::text);
  select * into r from jyoban_submit_report('tokenA1xxxxxxxxxxxxxxxxx','c1000000-0000-0000-0000-000000000001','onduty',(select v from t_v where k='dev2'));
  insert into t_v values ('rep2', r.report_id::text);
  -- 3 勤務表に入っていない人も上番できる（R5）
  insert into t_r values (3,'勤務表外の人も上番できる', r.error is null and r.report_id is not null, coalesce(r.error,''));
end $$;
-- 4 勤務員アプリからは取り消せない（R4）
do $$ declare e text; begin
  e := jyoban_void_report('tokenA1xxxxxxxxxxxxxxxxx', (select v from t_v where k='rep1')::uuid, (select v from t_v where k='dev1'));
  insert into t_r values (4,'勤務員アプリからは取り消せない', false, 'voided');
exception when others then insert into t_r values (4,'勤務員アプリからは取り消せない', sqlstate = '42501', sqlerrm); end $$;
-- 現場PCのセッション
do $$ declare r record; begin
  select * into r from app_site_open_session('AAA-0001','A-01','2468','受付PC'); insert into t_v values ('sess', r.session_token);
end $$;

-- 5 現場PCの一覧：自現場だけ・約定人数・配置者・報告・勤務表外の材料
do $$ declare b jsonb; s jsonb; begin
  b := sitepc_jyoban_board((select v from t_v where k='sess'));
  s := b->'sites'->0->'slots'->0;
  insert into t_r values (5,'現場PCの一覧は自現場だけで、約定人数・配置者・報告が入る',
    jsonb_array_length(b->'sites') = 1 and b->'sites'->0->>'code' = 'A-01'
    and s->'required_by_dow' = '[2,2,2,2,2,2,2]'::jsonb and jsonb_array_length(s->'roster') = 1
    and jsonb_array_length(s->'reports') = 2 and b ? 'now_local', left(b::text, 200));
end $$;
-- 6 現場PCは理由なしでは訂正できない／理由つきで取消できる
do $$ begin
  perform sitepc_jyoban_void((select v from t_v where k='sess'), (select v from t_v where k='rep2')::uuid, '');
  insert into t_r values (6,'理由なしの訂正は拒否', false, 'ok?');
exception when others then insert into t_r values (6,'理由なしの訂正は拒否', sqlerrm like '%理由%', sqlerrm); end $$;
do $$ begin
  perform sitepc_jyoban_void((select v from t_v where k='sess'), (select v from t_v where k='rep2')::uuid, '別の現場の人が誤って押した');
  insert into t_r values (7,'現場PCは理由つきで取消できる', true, '');
exception when others then insert into t_r values (7,'現場PCは理由つきで取消できる', false, sqlerrm); end $$;
-- 8 現場PCは後から登録できる（スマホを忘れた）
do $$ declare id uuid; begin
  id := sitepc_jyoban_add_report((select v from t_v where k='sess'), 'c1000000-0000-0000-0000-000000000001',
          (now() at time zone 'Asia/Tokyo')::date, 'onduty', '90003', to_char(now() at time zone 'Asia/Tokyo', 'HH24:MI'), 'スマホを自宅に忘れた');
  insert into t_v values ('rep3', id::text);
  insert into t_r values (8,'現場PCは理由つきで後から登録できる', id is not null, '');
exception when others then insert into t_r values (8,'現場PCは理由つきで後から登録できる', false, sqlerrm); end $$;
-- 9 同じ人の同じ報告は二重に登録できない／他社のスタッフNoは使えない
do $$ declare n int := 0; begin
  begin perform sitepc_jyoban_add_report((select v from t_v where k='sess'), 'c1000000-0000-0000-0000-000000000001',
          (now() at time zone 'Asia/Tokyo')::date, 'onduty', '90001', '00:00', '重複'); exception when others then if sqlerrm like '%すでにあります%' then n := n + 1; end if; end;
  begin perform sitepc_jyoban_add_report((select v from t_v where k='sess'), 'c2000000-0000-0000-0000-000000000002',
          (now() at time zone 'Asia/Tokyo')::date, 'onduty', '90003', '00:00', '他現場'); exception when others then if sqlerrm like '%この現場の勤務枠ではありません%' then n := n + 1; end if; end;
  insert into t_r values (9,'二重登録と他現場の勤務枠は拒否', n = 2, n::text);
end $$;
-- 10 現場PCで確認済みにできる
do $$ begin
  perform sitepc_jyoban_ack((select v from t_v where k='sess'), 'c1000000-0000-0000-0000-000000000001', (now() at time zone 'Asia/Tokyo')::date, '電話で確認');
  insert into t_r values (10,'現場PCで確認済みにできる', true, '');
exception when others then insert into t_r values (10,'現場PCで確認済みにできる', false, sqlerrm); end $$;
-- 11 anon は会社の一覧を呼べない
do $$ begin
  perform company_jyoban_board(null);
  insert into t_r values (11,'anon は会社の一覧を呼べない', false, 'ok?');
exception when others then insert into t_r values (11,'anon は会社の一覧を呼べない', sqlstate = '42501', sqlerrm); end $$;
reset role;

-- 12 訂正の結果と履歴が残る（元の記録は消えない）
do $$ declare a record; n int; begin
  select * into a from jyoban_reports where id = (select v from t_v where k='rep2')::uuid;
  select count(*) into n from jyoban_report_corrections;
  insert into t_r values (12,'取消しても記録は残り、理由・訂正者・履歴が残る',
    a.voided_at is not null and a.void_reason like '別の現場%' and a.voided_by = '現場PC（A社 現場1）' and n = 2, a.voided_by || ' / ' || n);
end $$;
do $$ declare a record; begin
  select * into a from jyoban_reports where id = (select v from t_v where k='rep3')::uuid;
  insert into t_r values (13,'後から登録は「誰が・なぜ」が付く', a.entered_by = '現場PC（A社 現場1）' and a.entry_reason = 'スマホを自宅に忘れた' and a.staff_name = '試験 三郎', coalesce(a.entered_by,'null'));
end $$;

-- 14〜18 会社アカウントの範囲
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000002', false);
do $$ declare b jsonb; begin
  b := company_jyoban_board(null);
  insert into t_r values (14,'本社PCは自社の全現場（他社なし）', jsonb_array_length(b->'sites') = 2
    and (select bool_and(x->>'code' like 'A-%') from jsonb_array_elements(b->'sites') x), (b->'sites')::text);
  perform company_jyoban_void((select v from t_v where k='rep3')::uuid, '本人が別日に出勤していた');
  insert into t_r values (15,'本社PCは訂正でき、訂正者はメールで残る',
    (select voided_by from jyoban_reports where id = (select v from t_v where k='rep3')::uuid) = 'hq@a.example', '');
end $$;
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000003', false);
do $$ declare b jsonb; begin
  b := company_jyoban_board(null);
  insert into t_r values (16,'支店は担当現場だけ', jsonb_array_length(b->'sites') = 1 and b->'sites'->0->>'code' = 'A-02', (b->'sites')::text);
  begin
    perform company_jyoban_void((select v from t_v where k='rep1')::uuid, '担当外');
    insert into t_r values (17,'支店は担当外の報告を訂正できない', false, 'voided');
  exception when others then insert into t_r values (17,'支店は担当外の報告を訂正できない', sqlerrm like '%権限がありません%', sqlerrm); end;
end $$;
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000004', false);
do $$ begin
  perform company_jyoban_board(null);
  insert into t_r values (18,'教育センターは一覧を見られない', false, 'ok?');
exception when others then insert into t_r values (18,'教育センターは一覧を見られない', sqlerrm like '%権限がありません%', sqlerrm); end $$;
select set_config('request.jwt.claim.sub', '22222222-0000-0000-0000-000000000001', false);
do $$ declare b jsonb; begin
  b := company_jyoban_board(null);
  insert into t_r values (19,'他社の管理者にはA社の現場が出ない', (b->'sites')::text not like '%A-0%', left((b->'sites')::text, 120));
  begin
    perform company_jyoban_ack('c1000000-0000-0000-0000-000000000001', (now() at time zone 'Asia/Tokyo')::date, 'x');
    insert into t_r values (20,'他社の勤務枠は確認済みにできない', false, 'ok?');
  exception when others then insert into t_r values (20,'他社の勤務枠は確認済みにできない', sqlerrm like '%権限がありません%', sqlerrm); end;
end $$;
reset role;
do $$ declare a record; begin
  select * into a from jyoban_acks where slot_id = 'c1000000-0000-0000-0000-000000000001';
  insert into t_r values (21,'確認済みは1件で、確認者は「現場PC」', a.acked_label = '現場PC' and a.memo = '電話で確認', coalesce(a.acked_label,'null'));
end $$;

select n||'. '||case when ok then 'PASS' else 'FAIL' end||'  '||name||case when ok then '' else '  ['||left(coalesce(detail,''),200)||']' end from t_r order by n;
