-- 0410_biometric_passkey の検証シナリオ（run_jyoban_rls_check.sh から実行）。各行 PASS/FAIL を出力する。
-- 前提: 0400〜0410 適用済み、jyoban_supabase_stub.sql 適用済み。
insert into companies(id,name,code) values
 ('a0000000-0000-0000-0000-00000000000a','A社','AAA-0001'),
 ('b0000000-0000-0000-0000-00000000000b','B社','BBB-0001');
insert into sites(id,name,code,company_id,report_token,shared_device_enabled,biometric_mode) values
 ('a1000000-0000-0000-0000-000000000001','A社 現場1(設定なし)','A-01','a0000000-0000-0000-0000-00000000000a','tokenA1xxxxxxxxxxxxxxxxx',false,'off'),
 ('a2000000-0000-0000-0000-000000000002','A社 現場2(必須)','A-02','a0000000-0000-0000-0000-00000000000a','tokenA2xxxxxxxxxxxxxxxxx',false,'required'),
 ('a3000000-0000-0000-0000-000000000003','A社 現場3(必須・共用端末)','A-03','a0000000-0000-0000-0000-00000000000a','tokenA3xxxxxxxxxxxxxxxxx',true,'required'),
 ('b1000000-0000-0000-0000-000000000001','B社 現場1','B-01','b0000000-0000-0000-0000-00000000000b','tokenB1xxxxxxxxxxxxxxxxx',false,'off');
insert into staff(id,company_id,staff_no,name,pin_hash,is_active) values
 ('5a000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','10234','笠井',extensions.crypt('1234',extensions.gen_salt('bf')),true),
 ('5a000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a','20001','萩原',extensions.crypt('5678',extensions.gen_salt('bf')),true),
 ('5b000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000b','10234','B社の笠井',extensions.crypt('1234',extensions.gen_salt('bf')),true);
-- 受付時間内の勤務枠（現在時刻(JST)の1時間後に始まる）。各現場に上番連絡のみ
insert into jyoban_slots(id,company_id,site_id,name,work_start,work_end,departure_required,departure_due,onduty_required,onduty_due)
select v.id::uuid, v.cid::uuid, v.sid::uuid, '日勤',
       to_char(t + interval '60 minutes','HH24:MI'), to_char(t + interval '8 hours','HH24:MI'), false, null, true, to_char(t + interval '45 minutes','HH24:MI')
  from (select date_trunc('minute', now() at time zone 'Asia/Tokyo') t) x,
       (values ('c1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','a1000000-0000-0000-0000-000000000001'),
               ('c2000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a','a2000000-0000-0000-0000-000000000002'),
               ('c3000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-00000000000a','a3000000-0000-0000-0000-000000000003'),
               ('cb000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000b','b1000000-0000-0000-0000-000000000001')) v(id,cid,sid);
insert into app_profiles(user_id,role,company_id) values ('11111111-1111-1111-1111-111111111111','company_admin','a0000000-0000-0000-0000-00000000000a');
grant select on companies, app_profiles to authenticated;

create table t_r(n int, name text, ok boolean, detail text);
grant insert, select on t_r to anon, authenticated, service_role;
create table t_secret(who text, secret text);
grant insert, select on t_secret to anon, service_role;
create table t_dev(who text, device_id uuid);
grant insert, select on t_dev to service_role;
create table t_rep(n int, report_id uuid, err text);
grant insert, select on t_rep to anon;
-- Supabase の service_role は全表に権限を持つ（RLSも無視）。スタブでは表権限だけ模擬する
grant all on all tables in schema public to service_role;

-- 端末登録（勤務員アプリ: 会社コード＋スタッフNo＋PIN）
set role anon;
do $$ declare r record; begin
  select * into r from jyoban_register_device_login('AAA-0001','10234','1234','iPhone');
  insert into t_secret values ('kasai', r.device_secret);
  select * into r from jyoban_register_device_login('AAA-0001','20001','5678','Android');
  insert into t_secret values ('hagi', r.device_secret);
  select * into r from jyoban_register_device_login('BBB-0001','10234','1234','B');
  insert into t_secret values ('bkasai', r.device_secret);
end $$;
-- 1 勤務員アプリ(anon)からゲートウェイ用RPCは呼べない
do $$ begin perform * from passkey_device_staff((select secret from t_secret where who='kasai'));
  insert into t_r values (1,'anon は passkey_device_staff を呼べない', false, 'called');
exception when insufficient_privilege then insert into t_r values (1,'anon は passkey_device_staff を呼べない', true, sqlerrm); end $$;
-- 2 anon は現場の設定だけ読める
do $$ begin insert into t_r values (2,'anon が現場の生体認証設定を読める',
  jyoban_site_biometric('tokenA2xxxxxxxxxxxxxxxxx') = 'required' and jyoban_site_biometric('nosuch') is null, ''); end $$;
reset role;

set role service_role;
-- 3 端末シークレット → 勤務員
do $$ declare r record; begin
  select * into r from passkey_device_staff((select secret from t_secret where who='kasai'));
  insert into t_dev values ('kasai', r.device_id);
  insert into t_r values (3,'端末シークレットで勤務員が分かる', r.staff_no = '10234' and r.credentials = '[]'::jsonb, coalesce(r.staff_name,''));
  select * into r from passkey_device_staff((select secret from t_secret where who='hagi'));
  insert into t_dev values ('hagi', r.device_id);
  select * into r from passkey_device_staff((select secret from t_secret where who='bkasai'));
  insert into t_dev values ('bkasai', r.device_id);
end $$;
-- 4 他社の会社コード・誤ったシークレットでは何も返らない
do $$ declare n int; m int; begin
  update jyoban_devices set revoked_at = now() where id = (select device_id from t_dev where who='bkasai');
  select count(*) into n from passkey_device_staff((select secret from t_secret where who='bkasai'));
  update jyoban_devices set revoked_at = null where id = (select device_id from t_dev where who='bkasai');
  select count(*) into m from passkey_device_staff(repeat('0',64));
  insert into t_r values (4,'失効した端末・誤シークレットは0件', n = 0 and m = 0, n||'/'||m);
end $$;
-- 5 チャレンジは1回だけ取り出せる
do $$ declare d uuid := (select device_id from t_dev where who='kasai'); a text; b text; begin
  perform passkey_save_challenge(d, 'register', 'challengeAAAAAAAAAAAAAAAA');
  a := passkey_take_challenge(d, 'register'); b := passkey_take_challenge(d, 'register');
  insert into t_r values (5,'チャレンジは1回限り', a = 'challengeAAAAAAAAAAAAAAAA' and b is null, coalesce(a,'-')||'/'||coalesce(b,'-'));
end $$;
-- 6 期限切れ・用途違い・古いチャレンジは使えない
do $$ declare d uuid := (select device_id from t_dev where who='kasai'); a text; b text; c text; begin
  perform passkey_save_challenge(d, 'verify', 'challengeOLDOLDOLDOLDOLDOLD');
  perform passkey_save_challenge(d, 'verify', 'challengeNEWNEWNEWNEWNEWNEW');
  a := passkey_take_challenge(d, 'register');
  b := passkey_take_challenge(d, 'verify');
  perform passkey_save_challenge(d, 'verify', 'challengeEXPEXPEXPEXPEXPEXP');
  update passkey_challenges set expires_at = now() - interval '1 second' where challenge = 'challengeEXPEXPEXPEXPEXPEXP';
  c := passkey_take_challenge(d, 'verify');
  insert into t_r values (6,'用途違い・古い・期限切れは不可', a is null and b = 'challengeNEWNEWNEWNEWNEWNEW' and c is null,
    coalesce(a,'-')||'/'||coalesce(b,'-')||'/'||coalesce(c,'-'));
end $$;
-- 7 パスキー登録 → 一覧に出る・端末に確認時刻
do $$ declare d uuid := (select device_id from t_dev where who='kasai'); r record; begin
  perform passkey_add(d, 'credKASAI_aaaaaaaaaaaaaaaa', 'pubkeyKASAI_bbbbbbbbbbbbbb', 0, '{internal,hybrid}', 'iPhone');
  perform passkey_add((select device_id from t_dev where who='bkasai'), 'credBKASAI_cccccccccccccccc', 'pubkeyBKASAI_dddddddddddd', 0, '{internal}', 'B');
  select * into r from passkey_device_staff((select secret from t_secret where who='kasai'));
  insert into t_r values (7,'パスキー登録', jsonb_array_length(r.credentials) = 1 and r.credentials->0->>'id' = 'credKASAI_aaaaaaaaaaaaaaaa'
    and (select bio_verified_at is not null from jyoban_devices where id = d), r.credentials::text);
end $$;
-- 8 他人の端末からは笠井のパスキーを使えない
do $$ declare n int; m int; begin
  select count(*) into n from passkey_get((select device_id from t_dev where who='hagi'), 'credKASAI_aaaaaaaaaaaaaaaa');
  select count(*) into m from passkey_get((select device_id from t_dev where who='kasai'), 'credKASAI_aaaaaaaaaaaaaaaa');
  insert into t_r values (8,'パスキーは本人の端末でだけ取得できる', n = 0 and m = 1, n||'/'||m);
end $$;
reset role;

-- 9 設定なしの現場: 確認から5分以内なら bio_verified=true で受付
set role anon;
do $$ declare r record; begin
  select * into r from jyoban_submit_report('tokenA1xxxxxxxxxxxxxxxxx','c1000000-0000-0000-0000-000000000001','onduty',
    (select secret from t_secret where who='kasai'));
  insert into t_rep values (9, r.report_id, r.error);
exception when others then insert into t_rep values (9, null, sqlerrm); end $$;
reset role;

-- 10 必須の現場: 確認から5分を過ぎていたら受け付けない
update jyoban_devices set bio_verified_at = now() - interval '10 minutes' where id = (select device_id from t_dev where who='kasai');
set role anon;
do $$ begin
  perform jyoban_submit_report('tokenA2xxxxxxxxxxxxxxxxx','c2000000-0000-0000-0000-000000000002','onduty',
    (select secret from t_secret where who='kasai'));
  insert into t_r values (10,'必須の現場で未確認なら拒否', false, 'accepted');
exception when others then insert into t_r values (10,'必須の現場で未確認なら拒否', sqlerrm like 'BIO_REQUIRED:%', sqlerrm); end $$;
-- 11 パスキーのない萩原も必須の現場では拒否
do $$ begin
  perform jyoban_submit_report('tokenA2xxxxxxxxxxxxxxxxx','c2000000-0000-0000-0000-000000000002','onduty',
    (select secret from t_secret where who='hagi'));
  insert into t_r values (11,'未登録の人も必須の現場では拒否', false, 'accepted');
exception when others then insert into t_r values (11,'未登録の人も必須の現場では拒否', sqlerrm like 'BIO_REQUIRED:%', sqlerrm); end $$;
reset role;

-- 12 本人確認に成功 → 必須の現場で受付・認証回数を更新
set role service_role;
do $$ declare d uuid := (select device_id from t_dev where who='kasai'); r record; begin
  select * into r from passkey_get(d, 'credKASAI_aaaaaaaaaaaaaaaa');
  perform passkey_mark_verified(d, r.id, 7);
end $$;
reset role;
set role anon;
do $$ declare r record; begin
  select * into r from jyoban_submit_report('tokenA2xxxxxxxxxxxxxxxxx','c2000000-0000-0000-0000-000000000002','onduty',
    (select secret from t_secret where who='kasai'));
  insert into t_rep values (12, r.report_id, r.error);
exception when others then insert into t_rep values (12, null, sqlerrm); end $$;
-- 13 共用端末（スタッフNo＋PIN）は対象外。bio_verified=false で受付
do $$ declare r record; begin
  select * into r from jyoban_submit_report('tokenA3xxxxxxxxxxxxxxxxx','c3000000-0000-0000-0000-000000000003','onduty',
    null, '20001', '5678');
  insert into t_rep values (13, r.report_id, r.error);
exception when others then insert into t_rep values (13, null, sqlerrm); end $$;
reset role;
insert into t_r values (14,'認証回数を更新', (select counter = 7 and last_used_at is not null from staff_passkeys where credential_id = 'credKASAI_aaaaaaaaaaaaaaaa'), '');

-- 15〜18 会社コンソール
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ begin
  perform company_set_site_biometric('a1000000-0000-0000-0000-000000000001', 'optional');
  insert into t_r values (15,'会社が自社現場の設定を変更', true, '');
exception when others then insert into t_r values (15,'会社が自社現場の設定を変更', false, sqlerrm); end $$;
do $$ begin
  perform company_set_site_biometric('b1000000-0000-0000-0000-000000000001', 'required');
  insert into t_r values (16,'他社現場の設定は変更できない', false, 'changed');
exception when others then insert into t_r values (16,'他社現場の設定は変更できない', sqlerrm like '対象現場が自社ではありません%', sqlerrm); end $$;
do $$ declare n int; begin
  select count(*) into n from staff_passkeys;
  insert into t_r values (17,'会社は自社のパスキーだけ見える', n = 1, n::text);
end $$;
do $$ declare n int; begin
  n := company_revoke_staff_passkeys('5a000000-0000-0000-0000-000000000001');
  insert into t_r values (18,'会社がパスキーを失効', n = 1, n::text);
exception when others then insert into t_r values (18,'会社がパスキーを失効', false, sqlerrm); end $$;
do $$ begin
  perform company_revoke_staff_passkeys('5b000000-0000-0000-0000-000000000001');
  insert into t_r values (19,'他社勤務員のパスキーは失効できない', false, 'revoked');
exception when others then insert into t_r values (19,'他社勤務員のパスキーは失効できない', sqlerrm like '対象の勤務員が自社ではありません%', sqlerrm); end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);
insert into t_r values (20,'失効後は取得できない',
  (select count(*) = 0 from passkey_get((select device_id from t_dev where who='kasai'), 'credKASAI_aaaaaaaaaaaaaaaa'))
  and (select biometric_mode = 'optional' from sites where id = 'a1000000-0000-0000-0000-000000000001'), '');

insert into t_r select 9, '確認直後の報告は bio_verified', p.err is null and j.bio_verified, coalesce(p.err,'') from t_rep p left join jyoban_reports j on j.id = p.report_id where p.n = 9;
insert into t_r select 12, '確認後は必須の現場でも受付', p.err is null and j.bio_verified, coalesce(p.err,'') from t_rep p left join jyoban_reports j on j.id = p.report_id where p.n = 12;
insert into t_r select 13, '共用端末は必須でも受付（未確認として記録）', p.err is null and not j.bio_verified, coalesce(p.err,'') from t_rep p left join jyoban_reports j on j.id = p.report_id where p.n = 13;
select n, case when ok then 'PASS' else 'FAIL' end, name, detail from t_r order by n;
