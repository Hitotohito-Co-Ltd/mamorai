-- 0406_jyoban の RLS/RPC 検証シナリオ（run_jyoban_rls_check.sh から実行）。各行 PASS/FAIL を出力する。
insert into companies(id,name,code) values
 ('a0000000-0000-0000-0000-00000000000a','A社','AAA-0001'),
 ('b0000000-0000-0000-0000-00000000000b','B社','BBB-0001');
insert into sites(id,name,code,company_id) values
 ('a1000000-0000-0000-0000-000000000001','A社 現場1','A-01','a0000000-0000-0000-0000-00000000000a'),
 ('a2000000-0000-0000-0000-000000000002','A社 現場2','A-02','a0000000-0000-0000-0000-00000000000a'),
 ('b1000000-0000-0000-0000-000000000001','B社 現場1','B-01','b0000000-0000-0000-0000-00000000000b');
insert into app_profiles(user_id,role,company_id) values
 ('11111111-1111-1111-1111-111111111111','company_admin','a0000000-0000-0000-0000-00000000000a'),
 ('22222222-2222-2222-2222-222222222222','company_admin','b0000000-0000-0000-0000-00000000000b');
grant select on companies, app_profiles to authenticated;
create table t_results(n int, name text, ok boolean, detail text);
grant insert, select on t_results to authenticated, anon;

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into t_results select 1,'A社: 自社2現場のみ一覧', count(*)=2, string_agg(name,',') from company_list_jyoban_sites();
do $$ begin
  insert into jyoban_slots(company_id,site_id,name,work_start,work_end,departure_required,departure_due,onduty_required,onduty_due)
  values ('a0000000-0000-0000-0000-00000000000a','a2000000-0000-0000-0000-000000000002','早番','08:15','15:00',true,'06:30',true,'08:15');
  insert into t_results values (2,'A社: 自社現場に勤務枠作成', true, '');
exception when others then insert into t_results values (2,'A社: 自社現場に勤務枠作成', false, sqlerrm); end $$;
do $$ begin
  insert into jyoban_slots(company_id,site_id,name,work_start,work_end,onduty_due)
  values ('a0000000-0000-0000-0000-00000000000a','b1000000-0000-0000-0000-000000000001','x','08:00','17:00','07:45');
  insert into t_results values (3,'A社: 他社現場への勤務枠作成は拒否', false, 'inserted!');
exception when others then insert into t_results values (3,'A社: 他社現場への勤務枠作成は拒否', true, sqlerrm); end $$;
do $$ begin
  insert into jyoban_slots(company_id,site_id,name,work_start,work_end,onduty_due)
  values ('b0000000-0000-0000-0000-00000000000b','b1000000-0000-0000-0000-000000000001','x','08:00','17:00','07:45');
  insert into t_results values (4,'A社: 他社IDでの作成は拒否', false, 'inserted!');
exception when others then insert into t_results values (4,'A社: 他社IDでの作成は拒否', true, sqlerrm); end $$;
do $$ begin
  insert into jyoban_slots(company_id,site_id,name,work_start,work_end,departure_required,onduty_due)
  values ('a0000000-0000-0000-0000-00000000000a','a1000000-0000-0000-0000-000000000001','x','08:00','17:00',true,'07:45');
  insert into t_results values (5,'要なのに締切なしは拒否', false, 'inserted!');
exception when others then insert into t_results values (5,'要なのに締切なしは拒否', true, sqlerrm); end $$;
do $$ begin
  insert into jyoban_slots(company_id,site_id,name,work_start,work_end,onduty_due)
  values ('a0000000-0000-0000-0000-00000000000a','a1000000-0000-0000-0000-000000000001','x','8:00','17:00','24:10');
  insert into t_results values (6,'時刻形式不正は拒否', false, 'inserted!');
exception when others then insert into t_results values (6,'時刻形式不正は拒否', true, sqlerrm); end $$;
do $$ declare t1 text; t2 text; begin
  t1 := company_issue_report_token('a1000000-0000-0000-0000-000000000001');
  t2 := company_issue_report_token('a1000000-0000-0000-0000-000000000001');
  insert into t_results values (7,'QR発行・再発行で旧トークン無効', length(t1)=24 and t1 ~ '^[A-Za-z0-9_-]+$' and t1<>t2
    and (select report_token from company_list_jyoban_sites() where site_id='a1000000-0000-0000-0000-000000000001')=t2, '');
end $$;
do $$ begin
  perform company_issue_report_token('b1000000-0000-0000-0000-000000000001');
  insert into t_results values (8,'他社現場のQR発行は拒否', false, 'issued!');
exception when others then insert into t_results values (8,'他社現場のQR発行は拒否', true, sqlerrm); end $$;
do $$ begin
  insert into jyoban_reports(company_id,site_id,slot_id,work_date,type,staff_no,staff_name)
  select company_id, site_id, id, current_date, 'onduty','1','x' from jyoban_slots limit 1;
  insert into t_results values (9,'報告の直接INSERTは不可', false, 'inserted!');
exception when others then insert into t_results values (9,'報告の直接INSERTは不可', true, sqlerrm); end $$;
do $$ begin
  perform company_set_shared_device('a1000000-0000-0000-0000-000000000001', true);
  insert into t_results select 10,'共用端末ONを保存', shared_device_enabled, '' from company_list_jyoban_sites() where site_id='a1000000-0000-0000-0000-000000000001';
end $$;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
insert into t_results select 11,'B社: A社の勤務枠は0件', count(*)=0, count(*)::text from jyoban_slots;
insert into t_results select 12,'B社: 一覧は自社1現場のみ', count(*)=1, string_agg(name,',') from company_list_jyoban_sites();
do $$ declare n int; begin
  update jyoban_slots set name='乗っ取り'; get diagnostics n = row_count;
  insert into t_results values (13,'B社: A社勤務枠の更新は0行', n=0, n::text);
end $$;
reset role;
set role anon;
do $$ begin
  perform company_list_jyoban_sites();
  insert into t_results values (14,'匿名: 会社RPCは実行不可', false, 'executed!');
exception when others then insert into t_results values (14,'匿名: 会社RPCは実行不可', true, sqlerrm); end $$;
reset role;
select n||'. '||case when ok then 'PASS' else 'FAIL' end||'  '||name from t_results order by n;
