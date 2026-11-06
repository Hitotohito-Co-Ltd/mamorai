-- 0409_jyoban_calls の検証シナリオ（run_jyoban_rls_check.sh から実行）。各行 PASS/FAIL を出力する。
-- 前提: 0400/0401/0402/0406/0407/0408/0409 適用済み、jyoban_supabase_stub.sql 適用済み。
insert into companies(id,name,code) values
 ('a0000000-0000-0000-0000-00000000000a','A社','AAA-0001'),
 ('b0000000-0000-0000-0000-00000000000b','B社','BBB-0001');
insert into sites(id,name,code,company_id,report_token,shared_device_enabled) values
 ('a1000000-0000-0000-0000-000000000001','A社 現場1','A-01','a0000000-0000-0000-0000-00000000000a','tokenA1xxxxxxxxxxxxxxxxx',false),
 ('b1000000-0000-0000-0000-000000000001','B社 現場1','B-01','b0000000-0000-0000-0000-00000000000b','tokenB1xxxxxxxxxxxxxxxxx',false);
insert into staff(id,company_id,staff_no,name,pin_hash,is_active,site_id) values
 ('5a000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','10234','笠井',extensions.crypt('1234',extensions.gen_salt('bf')),true,'a1000000-0000-0000-0000-000000000001'),
 ('5a000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a','20001','萩原',extensions.crypt('5678',extensions.gen_salt('bf')),true,'a1000000-0000-0000-0000-000000000001'),
 ('5b000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000b','10234','B社の笠井',extensions.crypt('1234',extensions.gen_salt('bf')),true,'b1000000-0000-0000-0000-000000000001');
-- 現在時刻(JST)の1時間後に始まる勤務枠。起床（今から10分後期限）・上番・下番あり
insert into jyoban_slots(id,company_id,site_id,name,work_start,work_end,departure_required,departure_due,onduty_required,onduty_due,
                         wakeup_required,wakeup_due,offduty_required,offduty_due)
select 'c1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','a1000000-0000-0000-0000-000000000001','日勤',
       to_char(t + interval '60 minutes','HH24:MI'), to_char(t + interval '8 hours','HH24:MI'), false, null, true, to_char(t + interval '45 minutes','HH24:MI'),
       true, to_char(t + interval '10 minutes','HH24:MI'), true, to_char(t + interval '8 hours','HH24:MI')
  from (select date_trunc('minute', now() at time zone 'Asia/Tokyo') t) x;
-- 起床・下番の列が無い（旧形式の）勤務枠も入る
insert into jyoban_slots(id,company_id,site_id,name,work_start,work_end,departure_required,departure_due,onduty_required,onduty_due)
values ('c2000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a','a1000000-0000-0000-0000-000000000001','旧形式','09:00','17:00',false,null,true,'08:45');
insert into app_profiles(user_id,role,company_id) values
 ('11111111-1111-1111-1111-111111111111','company_admin','a0000000-0000-0000-0000-00000000000a'),
 ('22222222-2222-2222-2222-222222222222','company_admin','b0000000-0000-0000-0000-00000000000b');
grant select on companies, app_profiles to authenticated;
-- Supabase の service_role は RLS をバイパスし全表を読める（模擬）
alter role service_role bypassrls;
grant select on all tables in schema public to service_role;

create table t_r(n int, name text, ok boolean, detail text);
grant insert, select on t_r to anon, authenticated, service_role;
create table t_secret(who text, secret text);
grant insert, select on t_secret to anon;

-- 1 制約: 起床を要にして期限なしは拒否
do $$ begin
  update jyoban_slots set wakeup_required = true, wakeup_due = null where id = 'c2000000-0000-0000-0000-000000000002';
  insert into t_r values (1,'起床「要」で期限なしは拒否', false, 'ok?');
exception when others then insert into t_r values (1,'起床「要」で期限なしは拒否', sqlstate = '23514', sqlerrm); end $$;
-- 2 制約: 電話番号の形式
do $$ begin
  update staff set phone = '12-345' where id = '5a000000-0000-0000-0000-000000000001';
  insert into t_r values (2,'電話番号の形式違いは拒否', false, 'ok?');
exception when others then insert into t_r values (2,'電話番号の形式違いは拒否', sqlstate = '23514', sqlerrm); end $$;

set role anon;
do $$ declare r record; begin
  select * into r from jyoban_register_device('tokenA1xxxxxxxxxxxxxxxxx','10234','1234','test-ua');
  insert into t_secret values ('kasai', r.device_secret);
end $$;
-- 3 表示内容に起床・下番が入る
do $$ declare c jsonb; s jsonb; begin
  c := jyoban_context('tokenA1xxxxxxxxxxxxxxxxx', (select secret from t_secret where who='kasai'));
  select x into s from jsonb_array_elements(c->'slots') x where x->>'name' = '日勤';
  insert into t_r values (3,'表示内容に起床・下番の要否と期限', (s->>'wakeup_required')::boolean and (s->>'offduty_required')::boolean
                                                          and s->>'wakeup_due' ~ '^\d\d:\d\d$', s::text);
end $$;
-- 4 起床連絡を送れる・2回目は重複扱い
do $$ declare r record; r2 record; begin
  select * into r from jyoban_submit_report('tokenA1xxxxxxxxxxxxxxxxx','c1000000-0000-0000-0000-000000000001','wakeup',(select secret from t_secret where who='kasai'));
  select * into r2 from jyoban_submit_report('tokenA1xxxxxxxxxxxxxxxxx','c1000000-0000-0000-0000-000000000001','wakeup',(select secret from t_secret where who='kasai'));
  insert into t_r values (4,'起床連絡の送信と重複防止', r.error is null and not r.duplicate and r2.duplicate and r2.report_id = r.report_id, coalesce(r.error,''));
end $$;
-- 5 下番連絡を送れる
do $$ declare r record; begin
  select * into r from jyoban_submit_report('tokenA1xxxxxxxxxxxxxxxxx','c1000000-0000-0000-0000-000000000001','offduty',(select secret from t_secret where who='kasai'));
  insert into t_r values (5,'下番連絡の送信', r.error is null and r.report_id is not null, coalesce(r.error,''));
end $$;
-- 6 不要な枠の起床連絡は拒否（旧形式の枠）
do $$ begin
  perform jyoban_submit_report('tokenA1xxxxxxxxxxxxxxxxx','c2000000-0000-0000-0000-000000000002','wakeup',(select secret from t_secret where who='kasai'));
  insert into t_r values (6,'起床不要の枠では起床連絡を拒否', false, 'ok?');
exception when others then insert into t_r values (6,'起床不要の枠では起床連絡を拒否', sqlerrm like '%起床連絡が不要%' or sqlerrm like '%受け付ける時間ではありません%', sqlerrm); end $$;
-- 7 不正な種類は拒否
do $$ begin
  perform jyoban_submit_report('tokenA1xxxxxxxxxxxxxxxxx','c1000000-0000-0000-0000-000000000001','sleep',(select secret from t_secret where who='kasai'));
  insert into t_r values (7,'不正な報告種類は拒否', false, 'ok?');
exception when others then insert into t_r values (7,'不正な報告種類は拒否', sqlerrm like '報告の種類が不正%', sqlerrm); end $$;
-- 8 Push購読の登録（端末シークレットで本人確認）
do $$ begin
  insert into t_r values (8,'Push購読の登録', jyoban_save_push_subscription((select secret from t_secret where who='kasai'),
    'https://push.example.com/abc', repeat('p',40), repeat('a',16)), '');
end $$;
-- 9 偽のシークレットでは購読登録できない
do $$ begin
  perform jyoban_save_push_subscription(repeat('0',64), 'https://push.example.com/zzz', repeat('p',40), repeat('a',16));
  insert into t_r values (9,'偽シークレットの購読登録は拒否', false, 'ok?');
exception when others then insert into t_r values (9,'偽シークレットの購読登録は拒否', sqlerrm like '本人登録が必要%', sqlerrm); end $$;
-- 10 anon は通知ワーカー用RPCを呼べない（電話番号・購読先を含むため）
do $$ begin
  perform jyoban_call_candidates(now());
  insert into t_r values (10,'anon は通知候補を取得できない', false, 'ok?');
exception when insufficient_privilege then insert into t_r values (10,'anon は通知候補を取得できない', true, ''); end $$;
reset role;

-- 会社（A社）の操作
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
-- 11 担当者に他社の隊員は入れられない
do $$ begin
  perform company_set_slot_staff('c1000000-0000-0000-0000-000000000001', array['5b000000-0000-0000-0000-000000000001'::uuid]);
  insert into t_r values (11,'他社の隊員は担当者にできない', false, 'ok?');
exception when others then insert into t_r values (11,'他社の隊員は担当者にできない', sqlerrm like '自社の隊員ではない%', sqlerrm); end $$;
-- 12 担当者の設定と一覧
do $$ declare n int; begin
  perform company_set_slot_staff('c1000000-0000-0000-0000-000000000001', array['5a000000-0000-0000-0000-000000000001'::uuid,'5a000000-0000-0000-0000-000000000002'::uuid]);
  perform company_set_slot_staff('c1000000-0000-0000-0000-000000000001', array['5a000000-0000-0000-0000-000000000002'::uuid]);
  select count(*) into n from company_list_slot_staff('c1000000-0000-0000-0000-000000000001') where assigned;
  insert into t_r values (12,'担当者の設定（入れ替え）', n = 1, n::text);
end $$;
-- 13 電話番号: ハイフン付きは正規化して保存・形式違いは拒否
do $$ declare p text; begin
  perform company_set_staff_phone('5a000000-0000-0000-0000-000000000002', '090-1234-5678');
  select phone into p from company_list_slot_staff('c1000000-0000-0000-0000-000000000001') where staff_no = '20001';
  begin
    perform company_set_staff_phone('5a000000-0000-0000-0000-000000000002', 'abc');
    insert into t_r values (13,'電話番号の正規化と形式チェック', false, 'invalid accepted');
  exception when others then insert into t_r values (13,'電話番号の正規化と形式チェック', p = '09012345678', p); end;
end $$;
-- 14 通知設定は自社分だけ作れる
do $$ begin
  insert into jyoban_notify_settings(email_to, sms_enabled, voice_enabled) values (array['kanri@example.com'], true, true);
  insert into t_r values (14,'自社の通知設定を作成', true, '');
exception when others then insert into t_r values (14,'自社の通知設定を作成', false, sqlerrm); end $$;
reset role;

-- 15 B社は A社の担当者・通知記録・通知設定を見られない
set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ declare n int; m int; begin
  select count(*) into n from jyoban_slot_staff;
  select count(*) into m from jyoban_notify_settings;
  insert into t_r values (15,'他社の担当者・通知設定は見えない', n = 0 and m = 0, n::text||'/'||m::text);
end $$;
reset role;

-- 通知ワーカー（service_role）
set role service_role;
-- 16 通知候補に、担当者・電話番号・購読先・報告済み種類が入る
do $$ declare c jsonb; s jsonb; a jsonb; begin
  c := jyoban_call_candidates(now());
  select x into s from jsonb_array_elements(c) x where x->'slot'->>'id' = 'c1000000-0000-0000-0000-000000000001';
  select x into a from jsonb_array_elements(s->'assignees') x where x->>'staffNo' = '20001';
  insert into t_r values (16,'通知候補の材料', s is not null and a->>'phone' = '09012345678'
      and jsonb_array_length(s->'reports') = 2 and (s->'settings'->>'sms')::boolean and (s->>'now_minutes')::int > 0, coalesce(s::text,'null'));
end $$;
-- 17 同じ知らせの記録は1回だけ（2回目は null）
do $$ declare id1 uuid; id2 uuid; st text; begin
  id1 := jyoban_claim_call('a0000000-0000-0000-0000-00000000000a','c1000000-0000-0000-0000-000000000001', current_date,'onduty','remind','sms','5a000000-0000-0000-0000-000000000002');
  id2 := jyoban_claim_call('a0000000-0000-0000-0000-00000000000a','c1000000-0000-0000-0000-000000000001', current_date,'onduty','remind','sms','5a000000-0000-0000-0000-000000000002');
  perform jyoban_finish_call(id1, 'sent', 'ok');
  select status into st from jyoban_notifications where id = id1;
  insert into t_r values (17,'通知の二重送信を防ぐ台帳', id1 is not null and id2 is null and st = 'sent', coalesce(st,''));
end $$;
-- 18 宛先なし（管制メール）も1回だけ
do $$ declare id1 uuid; id2 uuid; begin
  id1 := jyoban_claim_call('a0000000-0000-0000-0000-00000000000a','c1000000-0000-0000-0000-000000000001', current_date,'onduty','escalate','email',null);
  id2 := jyoban_claim_call('a0000000-0000-0000-0000-00000000000a','c1000000-0000-0000-0000-000000000001', current_date,'onduty','escalate','email',null);
  insert into t_r values (18,'管制メール（担当者なし）も1回だけ', id1 is not null and id2 is null, '');
end $$;
reset role;

-- 19 A社は自社の通知記録を閲覧できる
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ declare n int; begin
  select count(*) into n from jyoban_notifications;
  insert into t_r values (19,'自社の通知記録を閲覧', n = 2, n::text);
end $$;
reset role;
select n||'. '||case when ok then 'PASS' else 'FAIL' end||'  '||name||case when ok then '' else '  ['||left(coalesce(detail,''),160)||']' end from t_r order by n;
