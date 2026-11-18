-- 0411_roles_site_sessions の検証シナリオ（run_jyoban_rls_check.sh から実行）。各行 PASS/FAIL を出力する。
-- 前提: 0400〜0409・0411 適用済み、jyoban_supabase_stub.sql 適用済み。
create table if not exists auth.users(id uuid primary key, email text);
insert into auth.users values
 ('11111111-0000-0000-0000-000000000001','admin@a.example'),
 ('11111111-0000-0000-0000-000000000002','hq@a.example'),
 ('11111111-0000-0000-0000-000000000003','branch@a.example'),
 ('11111111-0000-0000-0000-000000000004','edu@a.example'),
 ('11111111-0000-0000-0000-000000000005','new@a.example'),
 ('22222222-0000-0000-0000-000000000001','admin@b.example');
insert into companies(id,name,code) values
 ('a0000000-0000-0000-0000-00000000000a','A社','AAA-0001'),
 ('b0000000-0000-0000-0000-00000000000b','B社','BBB-0001');
insert into sites(id,name,code,company_id) values
 ('a1000000-0000-0000-0000-000000000001','A社 現場1','A-01','a0000000-0000-0000-0000-00000000000a'),
 ('a2000000-0000-0000-0000-000000000002','A社 現場2','A-02','a0000000-0000-0000-0000-00000000000a'),
 ('b1000000-0000-0000-0000-000000000001','B社 現場1','B-01','b0000000-0000-0000-0000-00000000000b');
insert into app_site_credentials(company_code,site_code,pin_hash,site_id,company_id,site_name) values
 ('AAA-0001','A-01',extensions.crypt('2468',extensions.gen_salt('bf')),'a1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','A社 現場1'),
 ('AAA-0001','A-02',extensions.crypt('1357',extensions.gen_salt('bf')),'a2000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a','A社 現場2');
insert into staff(id,company_id,staff_no,name,dob,pin_hash,pin_current,is_active,site_id) values
 ('5a000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','10234','笠井',date '1990-04-15',extensions.crypt('1234',extensions.gen_salt('bf')),'1234',true,'a1000000-0000-0000-0000-000000000001'),
 ('5a000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a','20001','萩原',date '1985-01-02',extensions.crypt('5678',extensions.gen_salt('bf')),'5678',true,'a2000000-0000-0000-0000-000000000002');
insert into staff_sites(staff_id,site_id) values
 ('5a000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001'),
 ('5a000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000002');
insert into jyoban_slots(id,company_id,site_id,name,work_start,work_end,onduty_required,onduty_due) values
 ('c1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','a1000000-0000-0000-0000-000000000001','日勤','08:00','17:00',true,'07:45'),
 ('c2000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a','a2000000-0000-0000-0000-000000000002','日勤','08:00','17:00',true,'07:45');
insert into app_profiles(user_id,role,company_id) values
 ('11111111-0000-0000-0000-000000000001','company_admin','a0000000-0000-0000-0000-00000000000a'),
 ('11111111-0000-0000-0000-000000000002','hq_operator','a0000000-0000-0000-0000-00000000000a'),
 ('11111111-0000-0000-0000-000000000003','company_manager','a0000000-0000-0000-0000-00000000000a'),
 ('11111111-0000-0000-0000-000000000004','education_center','a0000000-0000-0000-0000-00000000000a'),
 ('22222222-0000-0000-0000-000000000001','company_admin','b0000000-0000-0000-0000-00000000000b');
insert into app_profile_sites(user_id,site_id,company_id) values
 ('11111111-0000-0000-0000-000000000003','a1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a');
grant select on companies, app_profiles, sites to authenticated;

create table t_r(n int, name text, ok boolean, detail text);
grant insert, select on t_r to anon, authenticated;
create table t_tok(who text, token text);
grant insert, select on t_tok to anon, authenticated;
create table t_dev(who text, secret text);
grant insert, select on t_dev to anon;

-- ── B) 現場PCのセッション ──
set role anon;
-- 1 旧関数は anon から呼べない
do $$ begin perform * from site_list_staff('AAA-0001','A-01');
  insert into t_r values (1,'旧 site_list_staff は呼べない', false, 'called');
exception when insufficient_privilege then insert into t_r values (1,'旧 site_list_staff は呼べない', true, ''); end $$;
do $$ begin perform site_reset_pin('AAA-0001','10234');
  insert into t_r values (2,'旧 site_reset_pin は呼べない', false, 'called');
exception when insufficient_privilege then insert into t_r values (2,'旧 site_reset_pin は呼べない', true, ''); end $$;
do $$ begin perform * from app_site_login('AAA-0001','A-01','2468');
  insert into t_r values (3,'旧 app_site_login は呼べない', false, 'called');
exception when insufficient_privilege then insert into t_r values (3,'旧 app_site_login は呼べない', true, ''); end $$;
-- 4 正しいPINでセッションが開く／誤PINは0件
do $$ declare r record; n int; begin
  select * into r from app_site_open_session('AAA-0001','A-01','2468','受付PC');
  insert into t_tok values ('a01', r.session_token);
  select count(*) into n from app_site_open_session('AAA-0001','A-01','0000');
  insert into t_r values (4,'現場PINでセッション（誤PINは0件）', length(r.session_token) = 64 and n = 0, n::text);
end $$;
-- 5 セッションで自分の現場の勤務員だけ
do $$ declare n int; m int; begin
  select count(*) into n from sitepc_list_staff((select token from t_tok where who='a01'));
  select count(*) into m from sitepc_list_staff((select token from t_tok where who='a01')) where staff_no = '20001';
  insert into t_r values (5,'自分の現場の勤務員だけ見える', n = 1 and m = 0, n||'/'||m);
end $$;
-- 6 偽トークン・空は拒否
do $$ begin perform * from sitepc_list_staff(repeat('0',64));
  insert into t_r values (6,'偽トークンは拒否', false, 'called');
exception when others then insert into t_r values (6,'偽トークンは拒否', sqlerrm like 'SESSION:%', sqlerrm); end $$;
-- 7 他の現場の勤務員のPINはリセットできない
do $$ begin perform sitepc_reset_pin((select token from t_tok where who='a01'),'20001');
  insert into t_r values (7,'他現場の勤務員のPINはリセット不可', false, 'reset');
exception when others then insert into t_r values (7,'他現場の勤務員のPINはリセット不可', sqlerrm like '対象の勤務員が見つかりません%', sqlerrm); end $$;
-- 8 他の現場の勤務員を同じスタッフNoで上書きできない
do $$ begin perform sitepc_register_staff((select token from t_tok where who='a01'),'20001','乗っ取り',date '2000-01-01',null,null,null);
  insert into t_r values (8,'他現場の勤務員を上書き不可', false, 'overwritten');
exception when others then insert into t_r values (8,'他現場の勤務員を上書き不可', sqlerrm like 'このスタッフNoは他の現場%', sqlerrm); end $$;
-- 9 自分の現場の勤務員は登録・PINリセットできる
do $$ declare p text; begin
  perform sitepc_register_staff((select token from t_tok where who='a01'),'30001','新人',date '2001-07-09',null,'隊員',null);
  p := sitepc_reset_pin((select token from t_tok where who='a01'),'30001');
  insert into t_r values (9,'自分の現場は登録・リセット可', p = '0709', p);
exception when others then insert into t_r values (9,'自分の現場は登録・リセット可', false, sqlerrm); end $$;
-- 10 ログアウト後は使えない
do $$ begin
  perform app_site_close_session((select token from t_tok where who='a01'));
  perform * from sitepc_list_staff((select token from t_tok where who='a01'));
  insert into t_r values (10,'ログアウト後は使えない', false, 'called');
exception when others then insert into t_r values (10,'ログアウト後は使えない', sqlerrm like 'SESSION:%', sqlerrm); end $$;
-- 11 現場PINの総当たりは10回でロック
do $$ declare i int; n int; begin
  for i in 1..10 loop perform * from app_site_open_session('AAA-0001','A-02', lpad(i::text,4,'0')); end loop;
  begin
    select count(*) into n from app_site_open_session('AAA-0001','A-02','1357');
    insert into t_r values (11,'現場PINは10回失敗でロック', false, 'opened '||n);
  exception when others then insert into t_r values (11,'現場PINは10回失敗でロック', sqlerrm like '%ロック%', sqlerrm); end;
end $$;

-- ── C) 勤務員アプリ ──
do $$ begin perform submit_leave('AAA-0001','A-01','10234','笠井','',current_date,current_date,1,'x');
  insert into t_r values (12,'旧 submit_leave は呼べない', false, 'called');
exception when insufficient_privilege then insert into t_r values (12,'旧 submit_leave は呼べない', true, ''); end $$;
-- 13 staff_login は誤PIN 5回でロック（正しいPINでも0件）
do $$ declare i int; n int; begin
  for i in 1..5 loop perform * from staff_login('AAA-0001','20001','0000'); end loop;
  select count(*) into n from staff_login('AAA-0001','20001','5678');
  insert into t_r values (13,'staff_login は5回失敗でロック', n = 0, n::text);
end $$;
-- 14 正しいPINならログインでき、端末登録 → 端末から有給申請（スタッフNo・氏名はサーバーが決める）
do $$ declare n int; r record; v uuid; begin
  select count(*) into n from staff_login('AAA-0001','10234','1234');
  select * into r from jyoban_register_device_login('AAA-0001','10234','1234','iPhone');
  insert into t_dev values ('kasai', r.device_secret);
  v := worker_submit_leave(r.device_secret, current_date + 7, current_date + 7, 1, '私用');
  insert into t_r values (14,'端末から本人の有給申請', n = 1 and v is not null, n::text);
exception when others then insert into t_r values (14,'端末から本人の有給申請', false, sqlerrm); end $$;
do $$ declare n int; begin
  select count(*) into n from worker_list_leave((select secret from t_dev where who='kasai'));
  insert into t_r values (15,'端末から自分の申請だけ見える', n = 1, n::text);
end $$;
do $$ begin perform worker_submit_hope(repeat('f',64), '2026-12', '{}'::jsonb, null);
  insert into t_r values (16,'未登録端末からシフト希望は出せない', false, 'submitted');
exception when others then insert into t_r values (16,'未登録端末からシフト希望は出せない', sqlerrm like 'DEVICE:%', sqlerrm); end $$;
-- 17 staff_change_pin は失敗を戻り値で返す
do $$ declare m text; begin
  m := staff_change_pin('AAA-0001','10234','9999','4321');
  insert into t_r values (17,'PIN変更の失敗は戻り値', m is not null, coalesce(m,'null'));
end $$;
reset role;
insert into t_r select 18, '申請者はサーバーが決める', staff_no = '10234' and staff_name = '笠井', '' from leave_requests where reason = '私用';

-- ── A) ロール ──
set role authenticated;
-- 19 管理者はメンバー一覧を見られる（自社のみ）
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000001', false);
do $$ declare n int; begin
  select count(*) into n from company_list_members();
  insert into t_r values (19,'管理者は自社メンバーを見られる', n = 4, n::text);
end $$;
-- 20 管理者がメンバーを追加・ロール変更（支店の担当現場つき）
do $$ declare u uuid; begin
  u := company_add_member('NEW@a.example', 'education_center');
  perform company_set_member_role(u, 'company_manager', array['a2000000-0000-0000-0000-000000000002'::uuid]);
  insert into t_r values (20,'管理者がメンバー追加・ロール変更', true, '');
exception when others then insert into t_r values (20,'管理者がメンバー追加・ロール変更', false, sqlerrm); end $$;
-- 21 他社の現場を担当にできない・他社アカウントを追加できない
do $$ begin perform company_set_member_role('11111111-0000-0000-0000-000000000005','company_manager',array['b1000000-0000-0000-0000-000000000001'::uuid]);
  insert into t_r values (21,'他社の現場は担当にできない', false, 'set');
exception when others then insert into t_r values (21,'他社の現場は担当にできない', sqlerrm like '%自社以外%', sqlerrm); end $$;
do $$ begin perform company_add_member('admin@b.example','hq_operator');
  insert into t_r values (22,'他社のアカウントは追加できない', false, 'added');
exception when others then insert into t_r values (22,'他社のアカウントは追加できない', sqlerrm like '%他の会社%', sqlerrm); end $$;
-- 23 自分を管理者以外にできない・自分を外せない・運営ロールは付けられない
do $$ declare a bool := false; b bool := false; c bool := false; begin
  begin perform company_set_member_role('11111111-0000-0000-0000-000000000001','hq_operator'); exception when others then a := true; end;
  begin perform company_remove_member('11111111-0000-0000-0000-000000000001'); exception when others then b := true; end;
  begin perform company_set_member_role('11111111-0000-0000-0000-000000000002','platform_admin'); exception when others then c := true; end;
  insert into t_r values (23,'自分の降格・削除、運営ロール付与は不可', a and b and c, a||'/'||b||'/'||c);
end $$;
-- 24 本社PCはメンバー管理できない・上番の設定を変えられない
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000002', false);
do $$ begin perform * from company_list_members();
  insert into t_r values (24,'本社PCはメンバー管理不可', false, 'listed');
exception when others then insert into t_r values (24,'本社PCはメンバー管理不可', sqlerrm like '%管理者だけ%', sqlerrm); end $$;
do $$ begin perform company_set_shared_device('a1000000-0000-0000-0000-000000000001', true);
  insert into t_r values (25,'本社PCは上番の設定を変えられない', false, 'changed');
exception when others then insert into t_r values (25,'本社PCは上番の設定を変えられない', sqlerrm like '対象現場が自社ではありません%', sqlerrm); end $$;
do $$ declare n int; begin
  delete from jyoban_slots where id = 'c1000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  insert into t_r values (26,'本社PCは勤務枠を消せない', n = 0, n::text);
exception when others then insert into t_r values (26,'本社PCは勤務枠を消せない', true, sqlerrm); end $$;
do $$ declare n int; begin
  select count(*) into n from jyoban_slots;
  insert into t_r values (27,'本社PCは勤務枠を見られる', n = 2, n::text);
end $$;
-- 28 支店・権限者は担当現場だけ設定できる
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000003', false);
do $$ declare a bool := false; b bool := false; begin
  begin perform company_set_shared_device('a1000000-0000-0000-0000-000000000001', true); a := true; exception when others then a := false; end;
  begin perform company_set_shared_device('a2000000-0000-0000-0000-000000000002', true); b := true; exception when others then b := false; end;
  insert into t_r values (28,'支店は担当現場だけ設定可', a and not b, a||'/'||b);
end $$;
-- 29 教育センターは現場のPIN一覧を見られない／管理者は見られる
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000004', false);
do $$ begin perform * from site_staff_pins('a1000000-0000-0000-0000-000000000001');
  insert into t_r values (29,'教育センターはPIN一覧不可', false, 'listed');
exception when others then insert into t_r values (29,'教育センターはPIN一覧不可', true, sqlerrm); end $$;
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000001', false);
do $$ declare n int; begin
  select count(*) into n from site_staff_pins('a1000000-0000-0000-0000-000000000001');
  insert into t_r values (30,'管理者はPIN一覧可', n >= 1, n::text);
exception when others then insert into t_r values (30,'管理者はPIN一覧可', false, sqlerrm); end $$;
-- 31 B社の管理者はA社のメンバーを変えられない
select set_config('request.jwt.claim.sub', '22222222-0000-0000-0000-000000000001', false);
do $$ begin perform company_remove_member('11111111-0000-0000-0000-000000000002');
  insert into t_r values (31,'他社の管理者はメンバーを変えられない', false, 'removed');
exception when others then insert into t_r values (31,'他社の管理者はメンバーを変えられない', sqlerrm like '対象のメンバーが見つかりません%', sqlerrm); end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);
insert into t_r values (32,'変更が記録される', (select count(*) >= 2 from app_role_audit), '');
insert into t_r values (33,'ロールに不正値は入らない', (select count(*) = 0 from app_profiles where role not in ('company_admin','company_manager','hq_operator','education_center','platform_admin')), '');
do $$ begin
  insert into app_profiles(user_id, role) values (gen_random_uuid(), 'admin');
  insert into t_r values (34,'CHECK制約が効く', false, 'inserted');
exception when check_violation then insert into t_r values (34,'CHECK制約が効く', true, ''); end $$;

select n, case when ok then 'PASS' else 'FAIL' end, name, detail from t_r order by n;
