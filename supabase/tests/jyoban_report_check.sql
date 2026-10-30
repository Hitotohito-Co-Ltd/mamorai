-- 0407_jyoban_report の検証シナリオ（run_jyoban_rls_check.sh から実行）。各行 PASS/FAIL を出力する。
-- 前提: 0400/0401/0402/0406/0407 適用済み、jyoban_supabase_stub.sql 適用済み。
insert into companies(id,name,code) values
 ('a0000000-0000-0000-0000-00000000000a','A社','AAA-0001'),
 ('b0000000-0000-0000-0000-00000000000b','B社','BBB-0001');
insert into sites(id,name,code,company_id,report_token,shared_device_enabled) values
 ('a1000000-0000-0000-0000-000000000001','A社 現場1','A-01','a0000000-0000-0000-0000-00000000000a','tokenA1xxxxxxxxxxxxxxxxx',false),
 ('a2000000-0000-0000-0000-000000000002','A社 現場2(共用)','A-02','a0000000-0000-0000-0000-00000000000a','tokenA2xxxxxxxxxxxxxxxxx',true),
 ('b1000000-0000-0000-0000-000000000001','B社 現場1','B-01','b0000000-0000-0000-0000-00000000000b','tokenB1xxxxxxxxxxxxxxxxx',true);
insert into staff(id,company_id,staff_no,name,pin_hash,is_active) values
 ('5a000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','10234','笠井',extensions.crypt('1234',extensions.gen_salt('bf')),true),
 ('5a000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a','20001','萩原',extensions.crypt('5678',extensions.gen_salt('bf')),true),
 ('5a000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-00000000000a','30001','ロック太郎',extensions.crypt('9999',extensions.gen_salt('bf')),true),
 ('5b000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000b','10234','B社の笠井',extensions.crypt('1234',extensions.gen_salt('bf')),true);
-- 現在時刻(JST)の1時間後に始まる勤務枠（受付時間内）。現場1は出発+上番、現場2は上番のみ
insert into jyoban_slots(id,company_id,site_id,name,work_start,work_end,departure_required,departure_due,onduty_required,onduty_due)
select 'c1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','a1000000-0000-0000-0000-000000000001','日勤',
       to_char(t + interval '60 minutes','HH24:MI'), to_char(t + interval '8 hours','HH24:MI'), true, to_char(t + interval '20 minutes','HH24:MI'), true, to_char(t + interval '45 minutes','HH24:MI')
  from (select date_trunc('minute', now() at time zone 'Asia/Tokyo') t) x;
insert into jyoban_slots(id,company_id,site_id,name,work_start,work_end,departure_required,departure_due,onduty_required,onduty_due)
select 'c2000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a','a2000000-0000-0000-0000-000000000002','荷捌',
       to_char(t + interval '60 minutes','HH24:MI'), to_char(t + interval '8 hours','HH24:MI'), false, null, true, to_char(t + interval '45 minutes','HH24:MI')
  from (select date_trunc('minute', now() at time zone 'Asia/Tokyo') t) x;
insert into app_profiles(user_id,role,company_id) values ('11111111-1111-1111-1111-111111111111','company_admin','a0000000-0000-0000-0000-00000000000a');
grant select on companies, app_profiles to authenticated;

create table t_r(n int, name text, ok boolean, detail text);
grant insert, select on t_r to anon, authenticated;
create table t_secret(who text, secret text);
grant insert, select on t_secret to anon;

set role anon;
-- 1 無効なQR
do $$ begin perform jyoban_context('nosuchtoken123456789012', null);
  insert into t_r values (1,'無効なQRは拒否', false, 'ok?');
exception when others then insert into t_r values (1,'無効なQRは拒否', sqlerrm like 'QRコードが無効です%', sqlerrm); end $$;
-- 2 PIN誤り → エラーを返し、試行が記録される（巻き戻らない）
do $$ declare r record; begin
  select * into r from jyoban_register_device('tokenA1xxxxxxxxxxxxxxxxx','10234','0000');
  insert into t_r values (2,'PIN誤りは error で返る', r.device_secret is null and r.error like 'スタッフNoまたはPIN%', r.error);
end $$;
-- 3 5回失敗後は正しいPINでもロック
do $$ declare r record; i int; begin
  for i in 1..5 loop perform * from jyoban_register_device('tokenA1xxxxxxxxxxxxxxxxx','30001','0000'); end loop;
  select * into r from jyoban_register_device('tokenA1xxxxxxxxxxxxxxxxx','30001','9999');
  insert into t_r values (3,'5回失敗でロック（正PINでも不可）', r.device_secret is null and r.error like '入力ミスが続いた%', r.error);
end $$;
-- 4 本人登録（笠井）→ 端末シークレット64桁
do $$ declare r record; begin
  select * into r from jyoban_register_device('tokenA1xxxxxxxxxxxxxxxxx','10234','1234','test-ua');
  insert into t_secret values ('kasai', r.device_secret);
  insert into t_r values (4,'本人登録でシークレット発行', r.error is null and r.device_secret ~ '^[0-9a-f]{64}$' and r.staff_name = '笠井', coalesce(r.error,''));
end $$;
do $$ declare r record; begin
  select * into r from jyoban_register_device('tokenA1xxxxxxxxxxxxxxxxx','20001','5678');
  insert into t_secret values ('hagi', r.device_secret);
end $$;
-- 5 表示内容
do $$ declare c jsonb; begin
  c := jyoban_context('tokenA1xxxxxxxxxxxxxxxxx', (select secret from t_secret where who='kasai'));
  insert into t_r values (5,'表示内容: 本人・受付中の勤務枠', c->'staff'->>'name' = '笠井' and jsonb_array_length(c->'slots') = 1
    and (c->'slots'->0->>'departure_required')::boolean, c::text);
end $$;
-- 6 上番連絡 → 2回目は二重登録しない / 同じclient_idの再送も同じ結果
do $$ declare a record; b record; c record; s text := (select secret from t_secret where who='kasai'); begin
  select * into a from jyoban_submit_report('tokenA1xxxxxxxxxxxxxxxxx','c1000000-0000-0000-0000-000000000001','onduty', s, p_client_id => 'e0000000-0000-0000-0000-000000000001');
  select * into b from jyoban_submit_report('tokenA1xxxxxxxxxxxxxxxxx','c1000000-0000-0000-0000-000000000001','onduty', s, p_client_id => 'e0000000-0000-0000-0000-000000000002');
  select * into c from jyoban_submit_report('tokenA1xxxxxxxxxxxxxxxxx','c1000000-0000-0000-0000-000000000001','onduty', s, p_client_id => 'e0000000-0000-0000-0000-000000000001');
  insert into t_r values (6,'上番連絡: 二重送信・再送は同じ1件', a.error is null and not a.duplicate and b.duplicate and c.duplicate
    and a.report_id = b.report_id and a.report_id = c.report_id, a.report_id::text);
end $$;
-- 7 不要な報告種別は拒否
do $$ begin
  perform jyoban_submit_report('tokenA2xxxxxxxxxxxxxxxxx','c2000000-0000-0000-0000-000000000002','departure', null, '10234','1234');
  insert into t_r values (7,'出発不要の枠に出発連絡は拒否', false, 'ok?');
exception when others then insert into t_r values (7,'出発不要の枠に出発連絡は拒否', sqlerrm like '%出発連絡が不要%', sqlerrm); end $$;
-- 8 共用OFFの現場は 端末登録なしでは報告不可
do $$ begin
  perform jyoban_submit_report('tokenA1xxxxxxxxxxxxxxxxx','c1000000-0000-0000-0000-000000000001','departure', null, '20001','5678');
  insert into t_r values (8,'共用OFFの現場は都度PIN報告不可', false, 'ok?');
exception when others then insert into t_r values (8,'共用OFFの現場は都度PIN報告不可', sqlerrm like '本人登録が必要%', sqlerrm); end $$;
-- 9 共用ONの現場: PIN誤りはエラー返却、正しければ via_shared で登録
do $$ declare a record; b record; begin
  select * into a from jyoban_submit_report('tokenA2xxxxxxxxxxxxxxxxx','c2000000-0000-0000-0000-000000000002','onduty', null, '20001','0000');
  select * into b from jyoban_submit_report('tokenA2xxxxxxxxxxxxxxxxx','c2000000-0000-0000-0000-000000000002','onduty', null, '20001','5678');
  insert into t_r values (9,'共用端末: PIN誤りは拒否・正しければ登録', a.report_id is null and a.error is not null and b.error is null and b.report_id is not null, coalesce(a.error,''));
end $$;
-- 10 共用ONは端末なしでも当日の報告が見える / 共用OFFは見えない
do $$ declare c2 jsonb; c1 jsonb; begin
  c2 := jyoban_context('tokenA2xxxxxxxxxxxxxxxxx', null);
  c1 := jyoban_context('tokenA1xxxxxxxxxxxxxxxxx', null);
  insert into t_r values (10,'共用ONのみ端末なしで報告状況が見える',
    jsonb_array_length(c2->'slots'->0->'reports') = 1 and c2->'staff' = 'null'::jsonb
    and jsonb_array_length(c1->'slots'->0->'reports') = 0, '');
end $$;
-- 11 その他報告: 遅刻は到着見込み必須
do $$ declare s text := (select secret from t_secret where who='kasai'); r record; begin
  begin
    perform jyoban_submit_report('tokenA1xxxxxxxxxxxxxxxxx','c1000000-0000-0000-0000-000000000001','other', s, p_other_kind => 'late');
    insert into t_r values (11,'遅刻は到着見込み必須', false, 'ok?');
  exception when others then
    select * into r from jyoban_submit_report('tokenA1xxxxxxxxxxxxxxxxx','c1000000-0000-0000-0000-000000000001','other', s, p_other_kind => 'late', p_eta => '09:10', p_note => '電車遅延');
    insert into t_r values (11,'遅刻は到着見込み必須（入れれば登録）', sqlerrm like '到着見込み%' and r.error is null and r.report_id is not null, sqlerrm);
  end;
end $$;
-- 12 取消: 本人のみ・取消後は再報告できる
do $$ declare k text := (select secret from t_secret where who='kasai'); h text := (select secret from t_secret where who='hagi'); rid uuid; r record; e text; begin
  select report_id into rid from jyoban_submit_report('tokenA1xxxxxxxxxxxxxxxxx','c1000000-0000-0000-0000-000000000001','onduty', k);
  begin
    perform jyoban_void_report('tokenA1xxxxxxxxxxxxxxxxx', rid, h);
    insert into t_r values (12,'他人の報告は取消不可', false, 'voided!');
  exception when others then insert into t_r values (12,'他人の報告は取消不可', true, sqlerrm); end;
  e := jyoban_void_report('tokenA1xxxxxxxxxxxxxxxxx', rid, k);
  select * into r from jyoban_submit_report('tokenA1xxxxxxxxxxxxxxxxx','c1000000-0000-0000-0000-000000000001','onduty', k);
  insert into t_r values (13,'本人は取消でき、取消後は再報告できる', e is null and r.report_id <> rid and not r.duplicate, '');
end $$;
-- 14 A社の端末シークレットはB社の現場では無効（共用ONの現場でもPINなしでは登録されない）
do $$ declare r record; begin
  select * into r from jyoban_submit_report('tokenB1xxxxxxxxxxxxxxxxx','c1000000-0000-0000-0000-000000000001','onduty', (select secret from t_secret where who='kasai'));
  insert into t_r values (14,'他社現場では端末シークレット無効', r.report_id is null and r.error is not null, coalesce(r.error,'no error'));
exception when others then insert into t_r values (14,'他社現場では端末シークレット無効', true, sqlerrm); end $$;
-- 15 匿名は表・内部関数に直接アクセスできない
do $$ begin perform count(*) from jyoban_reports; insert into t_r values (15,'匿名は報告表を直接読めない', false, 'read!');
exception when others then insert into t_r values (15,'匿名は報告表を直接読めない', true, sqlerrm); end $$;
do $$ begin perform jyoban_verify_pin('a0000000-0000-0000-0000-00000000000a','10234','1234'); insert into t_r values (16,'匿名はPIN照合関数を直接呼べない', false, 'called!');
exception when others then insert into t_r values (16,'匿名はPIN照合関数を直接呼べない', true, sqlerrm); end $$;
do $$ begin perform count(*) from jyoban_devices; insert into t_r values (17,'匿名は端末表を読めない', false, 'read!');
exception when others then insert into t_r values (17,'匿名は端末表を読めない', true, sqlerrm); end $$;
reset role;
-- 18 端末シークレットは平文で保存しない
insert into t_r select 18,'シークレットはハッシュのみ保存', not exists (select 1 from jyoban_devices d join t_secret t on d.secret_hash = t.secret), '';
-- 19 会社は自社の報告を閲覧できる
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into t_r select 19,'本社は自社の報告を閲覧', count(*) >= 4, count(*)::text from jyoban_reports;
reset role;
-- 20 勤務日の判定（input-core resolveWorkDate と同じ結果）
insert into t_r select 20,'勤務日判定がTSと一致', bool_and(got is not distinct from want), string_agg(coalesce(got::text,'null')||'/'||coalesce(want::text,'null'),' ')
from (
  select jyoban_work_date(row(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'x',ws,we,false,null,true,'00:00',5,'{0,1,2,3,4,5,6}'::smallint[],true,0,now(),now())::jyoban_slots, ts::timestamp) got, want::date want
  from (values
    ('08:15','15:00','2026-10-30 06:24','2026-10-30'),
    ('21:00','06:00','2026-10-31 02:00','2026-10-30'),
    ('21:00','06:00','2026-10-30 20:40','2026-10-30'),
    ('00:30','08:30','2026-10-29 23:50','2026-10-30'),
    ('21:00','06:00','2027-01-01 03:00','2026-12-31'),
    ('08:15','15:00','2026-10-30 18:00',null)
  ) v(ws,we,ts,want)
) x;
-- 21〜23 勤務員アプリのログインで端末登録（0408）
set role anon;
do $$ declare r record; begin
  select * into r from jyoban_register_device_login('AAA-0001','20001','0000');
  insert into t_r values (21,'ログイン端末登録: PIN誤りは error で返る', r.device_secret is null and r.error like 'スタッフNoまたはPIN%', coalesce(r.error,''));
end $$;
do $$ declare r record; c jsonb; begin
  select * into r from jyoban_register_device_login('AAA-0001','20001','5678','pwa');
  c := jyoban_context('tokenA1xxxxxxxxxxxxxxxxx', r.device_secret);
  insert into t_r values (22,'ログイン端末登録: 発行した端末で現場の報告画面に本人として入れる', r.error is null and c->'staff'->>'name' = '萩原', coalesce(r.error,'')||' '||coalesce(c->>'staff',''));
end $$;
do $$ begin
  perform jyoban_register_device_login('NOPE-0000','20001','5678');
  insert into t_r values (23,'ログイン端末登録: 不正な会社コードは拒否', false, 'ok?');
exception when others then insert into t_r values (23,'ログイン端末登録: 不正な会社コードは拒否', sqlerrm like '会社コード%', sqlerrm); end $$;
reset role;
select n||'. '||case when ok then 'PASS' else 'FAIL' end||'  '||name||case when ok then '' else '  ['||left(coalesce(detail,''),120)||']' end from t_r order by n;
