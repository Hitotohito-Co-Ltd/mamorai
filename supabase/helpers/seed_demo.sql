-- デモ用テナントの作成（架空データのみ）— Supabase の SQL Editor で実行
-- ------------------------------------------------------------------
-- 目的: 社内説明・会議・新しい開発メンバー向けに、実在の人・現場を含まない
--       デモ会社「デモ警備株式会社」(会社コード DEMO-0001) と、各ログイン系統のアカウントを用意する。
--
-- どこで実行するか:
--   ・検証用(ステージング)の Supabase プロジェクトを推奨。
--   ・本番で実行しても、触るのは会社コード DEMO-0001 のデータだけ（RLSで他社からは見えない）。
--
-- 前提: マイグレーション 0400〜0409 を適用済み。SQL Editor は service_role で動くため RLS はバイパスされる。
--
-- 事前の手作業（会社ログイン /co 用。メール＋パスワードは Supabase Auth で作る）:
--   Authentication → Users → "Add user" → "Create new user"（Auto Confirm User にチェック）で次の2件を作成。
--     demo-admin@example.com     … 会社管理者(company_admin)
--     demo-manager@example.com   … 権限者(company_manager)
--   ※ パスワードは各自で強いものを設定し、リポジトリやチャットに書かない。
--   ※ 別のメールにしたい場合は、下の v_admin_email / v_manager_email を書き換える。
--   作っていなくてもこのSQLは通り、最後の一覧に「未作成」と出る（作成後にもう一度実行すれば紐付く）。
--
-- PIN について:
--   ・現場PIN・勤務員PINは、実行のたびにランダムな4桁を発行し直す（固定PINをリポジトリに残さないため）。
--   ・発行したPINは最後の SELECT にだけ表示される。結果をその場で控え、共有はパスワード管理ツール等で行う。
--   ・デモで繰り返しログインできるよう、勤務員の「初回PIN変更」は求めない設定にしている。
--
-- 通知について: SMS・自動音声電話・メールはオフ。勤務員の電話番号も登録しない（実在の番号に発信しないため）。
-- 冪等: 何度実行しても重複しない。消すときは reset_demo.sql を実行する。
-- ------------------------------------------------------------------

create extension if not exists pgcrypto with schema extensions;

drop table if exists pg_temp.demo_credentials;
create temp table demo_credentials (
  sort   int,
  系統   text,
  対象   text,
  ログインに使うもの text,
  PIN    text
);

do $$
declare
  v_admin_email   text := 'demo-admin@example.com';
  v_manager_email text := 'demo-manager@example.com';
  v_code    text := 'DEMO-0001';
  v_company uuid;
  v_today   date := (now() at time zone 'Asia/Tokyo')::date;
  v_pin     text;
  v_site    uuid;
  v_slot    uuid;
  v_staff   uuid;
  v_token   text;
  v_user    uuid;
  s record;
  r record;
  k record;
begin
  -- 4桁のランダムPIN（暗号学的乱数）
  create or replace function pg_temp.demo_pin() returns text language sql volatile as $f$
    select lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 10000)::text, 4, '0')
  $f$;

  -- 1) 会社
  insert into public.companies(name, code, plan, is_active)
  select 'デモ警備株式会社', v_code, 'demo', true
  where not exists (select 1 from public.companies where code = v_code);
  select id into v_company from public.companies where code = v_code;

  -- 2) 現場（架空）と現場ログイン資格（会社コード＋施設コード＋現場PIN）
  for s in select * from (values
      (1, 'DEMO-SC01', 'デモ商業施設 中央館',   '施設警備部 第1グループ'),
      (2, 'DEMO-OF02', 'デモオフィスタワー',     '施設警備部 第2グループ'),
      (3, 'DEMO-EV03', 'デモイベント会場',       'イベント警備部')
    ) as t(n, code, name, dept)
  loop
    insert into public.sites(name, code, dept, company_id, is_active, shared_device_enabled)
    select s.name, s.code, s.dept, v_company, true, (s.n = 1)
    where not exists (select 1 from public.sites where code = s.code and company_id = v_company);
    select id into v_site from public.sites where code = s.code and company_id = v_company;

    -- 上番報告用のQRトークン（未発行なら発行）
    if (select report_token from public.sites where id = v_site) is null then
      loop
        v_token := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_');
        exit when not exists (select 1 from public.sites where report_token = v_token);
      end loop;
      update public.sites set report_token = v_token, report_token_issued_at = now() where id = v_site;
    end if;

    v_pin := pg_temp.demo_pin();
    if exists (select 1 from public.app_site_credentials where company_code = v_code and site_code = s.code) then
      update public.app_site_credentials
         set pin_hash = extensions.crypt(v_pin, extensions.gen_salt('bf')), site_name = s.name, site_id = v_site
       where company_code = v_code and site_code = s.code;
    else
      insert into public.app_site_credentials(company_code, site_code, pin_hash, site_id, company_id, site_name)
      values (v_code, s.code, extensions.crypt(v_pin, extensions.gen_salt('bf')), v_site, v_company, s.name);
    end if;
    insert into demo_credentials values (200 + s.n, '現場 /s', s.name,
      '会社コード ' || v_code || ' ／ 施設コード ' || s.code, v_pin);
  end loop;

  -- 3) 勤務枠（出発・上番連絡の要否は現場ごとに違う例）
  for k in select * from (values
      ('DEMO-SC01', '日勤',     '08:00', '17:00', true,  '07:00', true, '07:50', 1),
      ('DEMO-SC01', '夜勤',     '21:00', '06:00', false, null,    true, '20:50', 2),
      ('DEMO-OF02', '日勤（1名配置）', '07:00', '16:00', true, '06:00', true, '06:50', 1),
      ('DEMO-EV03', '交通誘導', '09:00', '18:00', false, null,    true, '08:45', 1)
    ) as t(site_code, name, ws, we, dep_req, dep_due, on_req, on_due, ord)
  loop
    select id into v_site from public.sites where code = k.site_code and company_id = v_company;
    if not exists (select 1 from public.jyoban_slots where site_id = v_site and name = k.name) then
      insert into public.jyoban_slots(company_id, site_id, name, work_start, work_end,
             departure_required, departure_due, onduty_required, onduty_due, grace_min, sort_order)
      values (v_company, v_site, k.name, k.ws, k.we, k.dep_req, k.dep_due, k.on_req, k.on_due, 5, k.ord);
    end if;
  end loop;

  -- 4) 勤務員（架空。名前に「デモ」を付けて実在の人と区別する）
  for r in select * from (values
      (1, '9001', 'デモ 青木 一郎', date '1980-04-01', '現場責任者', 'DEMO-SC01', '日勤'),
      (2, '9002', 'デモ 石田 次郎', date '1986-07-15', '隊員',       'DEMO-SC01', '日勤'),
      (3, '9003', 'デモ 上野 三郎', date '1992-10-20', '隊員',       'DEMO-SC01', '夜勤'),
      (4, '9004', 'デモ 江口 四郎', date '1975-01-30', '現場責任者', 'DEMO-OF02', '日勤（1名配置）'),
      (5, '9005', 'デモ 大島 五月', date '1998-05-05', '隊員',       'DEMO-EV03', '交通誘導'),
      (6, '9006', 'デモ 加藤 六花', date '2001-12-12', '隊員',       'DEMO-EV03', '交通誘導')
    ) as t(n, no, name, dob, role, site_code, slot_name)
  loop
    select id into v_site from public.sites where code = r.site_code and company_id = v_company;
    v_pin := pg_temp.demo_pin();
    insert into public.staff(company_id, staff_no, name, dob, dept, role,
                             pin_hash, pin_current, pin_must_change, is_active, site_id)
    values (v_company, r.no, r.name, r.dob,
            (select dept from public.sites where id = v_site), r.role,
            extensions.crypt(v_pin, extensions.gen_salt('bf')), v_pin, false, true, v_site)
    on conflict (company_id, staff_no) do update
      set name = excluded.name, role = excluded.role, site_id = excluded.site_id,
          pin_hash = excluded.pin_hash, pin_current = excluded.pin_current,
          pin_must_change = false, is_active = true
    returning id into v_staff;
    insert into public.staff_sites(staff_id, site_id) values (v_staff, v_site) on conflict do nothing;

    select id into v_slot from public.jyoban_slots where site_id = v_site and name = r.slot_name;
    insert into public.jyoban_slot_staff(slot_id, staff_id, company_id)
    values (v_slot, v_staff, v_company) on conflict do nothing;

    insert into demo_credentials values (300 + r.n, '勤務員アプリ /app', r.name || '（' || r.role || '）',
      '会社コード ' || v_code || ' ／ スタッフNo ' || r.no, v_pin);
  end loop;

  -- 5) 通知設定: アプリ通知のみ。SMS・電話・メールはオフ（実在の宛先に送らない）
  insert into public.jyoban_notify_settings(company_id, enabled, email_to, push_enabled, sms_enabled, voice_enabled)
  values (v_company, true, '{}', true, false, false)
  on conflict (company_id) do update
    set email_to = '{}', sms_enabled = false, voice_enabled = false, updated_at = now();

  -- 6) 今日の上番報告の例（本社の現場一覧で「報告あり／未報告／遅刻連絡」が見えるように）
  if not exists (select 1 from public.jyoban_reports where company_id = v_company and work_date = v_today) then
    insert into public.jyoban_reports(company_id, site_id, slot_id, work_date, type, staff_id, staff_no, staff_name,
                                      other_kind, eta, note, received_at)
    select v_company, sl.site_id, sl.id, v_today, x.type, st.id, st.staff_no, st.name,
           x.other_kind, x.eta, x.note, (v_today + x.at) at time zone 'Asia/Tokyo'
      from (values
        ('9001', '日勤',     'departure', null::text, null::text, null::text, time '06:52'),
        ('9001', '日勤',     'onduty',    null,       null,       null,       time '07:45'),
        ('9002', '日勤',     'departure', null,       null,       null,       time '06:58'),
        ('9005', '交通誘導', 'other',     'traffic_delay', '09:20', 'デモ：電車の遅延で20分ほど遅れます', time '08:30')
      ) as x(no, slot_name, type, other_kind, eta, note, at)
      join public.staff st on st.company_id = v_company and st.staff_no = x.no
      join public.jyoban_slots sl on sl.company_id = v_company and sl.name = x.slot_name;
  end if;

  -- 7) 研修（教育センターの日程の例）と受講申込
  if not exists (select 1 from public.seminars where company_id = v_company) then
    insert into public.seminars(company_id, title, kind, held_on, place, capacity) values
      (v_company, '現任教育 基本（4時間）午前', '現任', date '2026-12-08', '研修室2',    22),
      (v_company, '現任教育 基本（4時間）午前', '現任', date '2026-12-10', '研修室1・2', 40),
      (v_company, '現任教育 1号業務別（6時間）', '現任', date '2026-12-04', '研修室1・2', 40),
      (v_company, '現任教育 2号業務別（6時間）', '現任', date '2026-12-01', '研修室2',    22),
      (v_company, '新任教育（3日間）',          '新任', date '2026-12-05', '研修室1',    18);
    insert into public.training_apps(company_id, site_id, staff_no, staff_name, dob, dept,
                                     seminar_id, seminar_title, kind, status, submitted_at)
    select v_company, st.site_id, st.staff_no, st.name, st.dob, st.dept, se.id, se.title, se.kind, '申請中', v_today
      from (values ('9002', date '2026-12-10'), ('9006', date '2026-12-05')) as a(no, held)
      join public.staff st on st.company_id = v_company and st.staff_no = a.no
      join public.seminars se on se.company_id = v_company and se.held_on = a.held;
  end if;

  -- 8) お知らせと有給申請の例
  if not exists (select 1 from public.notices where company_id = v_company) then
    insert into public.notices(company_id, scope, category, title, body, from_label, posted_on) values
      (v_company, 'company', 'お知らせ', '【デモ】年末年始の勤務体制について', 'これはデモ用のお知らせです。', '本社', v_today),
      (v_company, 'company', '研修',     '【デモ】12月の現任教育の申込受付を開始しました', 'これはデモ用のお知らせです。', '教育センター', v_today);
  end if;
  if not exists (select 1 from public.leave_requests where company_id = v_company) then
    insert into public.leave_requests(company_id, site_id, staff_no, staff_name, dept,
                                      date_from, date_to, days, reason, status, submitted_at)
    select v_company, st.site_id, st.staff_no, st.name, st.dept,
           v_today + 14, v_today + 14, 1, 'デモ：私用のため', '申請中', v_today
      from public.staff st where st.company_id = v_company and st.staff_no = '9003';
  end if;

  -- 9) 会社ログイン(/co)アカウントの紐付け（Auth ユーザーが作成済みなら）
  for r in select * from (values (1, v_admin_email, 'company_admin', '会社管理者'),
                                 (2, v_manager_email, 'company_manager', '権限者')) as t(n, email, role, label)
  loop
    select id into v_user from auth.users where lower(email) = lower(r.email);
    if v_user is null then
      insert into demo_credentials values (100 + r.n, '会社 /co', r.label,
        r.email || ' （未作成：Authentication → Users で作成後に再実行）', '—');
    else
      insert into public.app_profiles(user_id, role, company_id) values (v_user, r.role, v_company)
      on conflict (user_id) do update set role = excluded.role, company_id = excluded.company_id;
      insert into demo_credentials values (100 + r.n, '会社 /co', r.label,
        r.email || ' ＋ 作成時に設定したパスワード', '—');
    end if;
  end loop;
end $$;

-- 発行結果（この画面にだけ表示。控えたら閉じる）
select 系統, 対象, ログインに使うもの, PIN from demo_credentials order by sort;
