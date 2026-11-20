-- 0412_jyoban_geofence.sql — 上番・下番の位置確認（ジオフェンス）
--   現場ごとに地点（緯度・経度。Plus Code で入力）と半径を決め、上番連絡・下番連絡のときに
--   スマホの位置を記録する。「範囲内でのみ報告可」の現場では、範囲外からの上番・下番を受け付けない。
--
--   ・geo_mode: off（使わない）/ record（記録だけ。範囲外でも受け付ける）/ required（範囲内でのみ受け付ける）
--   ・判定: 中心からの距離 ≤ 半径 ＋ min(誤差, 100m)。誤差が 300m を超える位置は判定に使わない
--     （packages/input-core/src/geo/geofence.ts の judgeGeofence と同じ。画面は事前の案内、最終判定はここ）
--   ・位置は報告の瞬間だけ取得する（常時の追跡はしない）。「使わない」の現場では保存しない。
--   ・位置はスマホから送られた値で、偽装アプリ等で変えられる。生体認証（0410）と組み合わせて使う想定。
--
-- 安全・冪等: 追加のみ（ADD COLUMN IF NOT EXISTS・制約は存在確認つき）。追加列はNULL許容。
--   jyoban_submit_report は引数を3つ（p_lat, p_lng, p_accuracy_m・いずれも既定 NULL）足すため、
--   旧シグネチャを drop して作り直す（旧アプリからの呼び出しはそのまま新しい関数に当たる）。

-- ── 1) 現場の地点と範囲 ─────────────────────────────────────────────
alter table public.sites add column if not exists geo_mode       text default 'off';  -- NULL は off 扱い
alter table public.sites add column if not exists geo_lat        double precision;
alter table public.sites add column if not exists geo_lng        double precision;
alter table public.sites add column if not exists geo_radius_m   integer default 200;
alter table public.sites add column if not exists geo_label      text;                -- 入力された Plus Code 等（表示用）
alter table public.sites add column if not exists geo_updated_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sites_geo_mode_chk') then
    alter table public.sites add constraint sites_geo_mode_chk check (geo_mode is null or geo_mode in ('off', 'record', 'required'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sites_geo_point_chk') then
    alter table public.sites add constraint sites_geo_point_chk check (
      (geo_lat is null and geo_lng is null)
      or (geo_lat between -90 and 90 and geo_lng between -180 and 180));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sites_geo_radius_chk') then
    alter table public.sites add constraint sites_geo_radius_chk check (geo_radius_m is null or geo_radius_m between 30 and 2000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sites_geo_needs_point_chk') then
    alter table public.sites add constraint sites_geo_needs_point_chk check (coalesce(geo_mode, 'off') = 'off' or geo_lat is not null);
  end if;
end $$;

-- ── 2) 報告に位置を残す ─────────────────────────────────────────────
alter table public.jyoban_reports add column if not exists geo_lat        double precision;
alter table public.jyoban_reports add column if not exists geo_lng        double precision;
alter table public.jyoban_reports add column if not exists geo_accuracy_m real;
alter table public.jyoban_reports add column if not exists geo_distance_m integer;   -- 現場の中心からの距離（m）
alter table public.jyoban_reports add column if not exists geo_status     text;      -- NULL＝位置確認の対象外

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'jyoban_reports_geo_status_chk') then
    alter table public.jyoban_reports add constraint jyoban_reports_geo_status_chk
      check (geo_status is null or geo_status in ('inside', 'outside', 'low_accuracy', 'no_fix'));
  end if;
end $$;

-- ── 3) 距離と判定 ──────────────────────────────────────────────────
create or replace function public.jyoban_geo_distance_m(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns double precision language sql immutable set search_path = public as $$
  select 2 * 6371008.8 * asin(least(1, sqrt(
    power(sin(radians(b_lat - a_lat) / 2), 2)
    + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2))));
$$;

create or replace function public.jyoban_geo_fmt_m(p double precision)
returns text language sql immutable set search_path = public as $$
  select case when p >= 1000 then to_char(round((p / 1000.0)::numeric, 1), 'FM990.0') || 'km'
              else (round(p / 10) * 10)::int::text || 'm' end;
$$;

-- 画面（judgeGeofence）と同じ判定。allowed=false のときだけ報告を止める。
create or replace function public.jyoban_geo_judge(
  p_mode text, p_site_lat double precision, p_site_lng double precision, p_radius_m integer,
  p_lat double precision, p_lng double precision, p_accuracy_m double precision
) returns table(status text, distance_m double precision, allowed boolean, message text)
language plpgsql immutable set search_path = public as $$
declare v_req boolean := coalesce(p_mode, 'off') = 'required'; v_d double precision; v_acc double precision; v_r integer := coalesce(p_radius_m, 200);
begin
  if coalesce(p_mode, 'off') = 'off' or p_site_lat is null or p_site_lng is null then
    status := 'inside'; distance_m := null; allowed := true; message := ''; return next; return;
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    status := 'no_fix'; distance_m := null; allowed := not v_req;
    message := case when v_req then '位置を確認できないため報告できません。位置情報をオンにして、もう一度お試しください'
                    else '位置を確認できませんでした（このまま報告できます）' end;
    return next; return;
  end if;
  v_d := public.jyoban_geo_distance_m(p_site_lat, p_site_lng, p_lat, p_lng);
  v_acc := case when p_accuracy_m is null or p_accuracy_m < 0 then 301 else p_accuracy_m end;
  if v_acc > 300 then
    status := 'low_accuracy'; distance_m := v_d; allowed := not v_req;
    message := case when v_req then format('位置の誤差が大きすぎます（約%s）。窓際や屋外で、もう一度位置を取得してください', public.jyoban_geo_fmt_m(v_acc))
                    else format('位置の誤差が大きいため、範囲内か判定できませんでした（約%s）', public.jyoban_geo_fmt_m(v_acc)) end;
    return next; return;
  end if;
  if v_d <= v_r + least(v_acc, 100) then
    status := 'inside'; distance_m := v_d; allowed := true;
    message := format('現場の範囲内です（中心から約%s）', public.jyoban_geo_fmt_m(v_d));
    return next; return;
  end if;
  status := 'outside'; distance_m := v_d; allowed := not v_req;
  message := case when v_req then format('現場から約%s離れています。現場（半径%s）に着いてから報告してください', public.jyoban_geo_fmt_m(v_d), public.jyoban_geo_fmt_m(v_r))
                  else format('現場から約%s離れています（範囲外として記録されます）', public.jyoban_geo_fmt_m(v_d)) end;
  return next;
end $$;

-- ── 4) 勤務員PWA: 現場の位置確認の設定（QRトークンで照会）────────────
--   「使わない」の現場では地点を返さない。
create or replace function public.jyoban_site_geofence(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_site public.sites; v_on boolean;
begin
  v_site := public.jyoban_site_by_token(p_token);
  v_on := coalesce(v_site.geo_mode, 'off') <> 'off' and v_site.geo_lat is not null;
  return jsonb_build_object(
    'mode', case when v_on then v_site.geo_mode else 'off' end,
    'lat', case when v_on then v_site.geo_lat end,
    'lng', case when v_on then v_site.geo_lng end,
    'radius_m', coalesce(v_site.geo_radius_m, 200));
end $$;

-- ── 5) 勤務員PWA: 報告の送信（上番・下番で位置を確認する）──────────────
drop function if exists public.jyoban_submit_report(text,uuid,text,text,text,text,text,text,text,uuid,timestamptz);
create or replace function public.jyoban_submit_report(
  p_token text, p_slot_id uuid, p_type text,
  p_device_secret text default null, p_staff_no text default null, p_pin text default null,
  p_other_kind text default null, p_eta text default null, p_note text default null,
  p_client_id uuid default null, p_client_at timestamptz default null,
  p_lat double precision default null, p_lng double precision default null, p_accuracy_m double precision default null
) returns table(report_id uuid, work_date date, received_at text, duplicate boolean, error text)
language plpgsql security definer set search_path = public as $$
declare v_site public.sites; v_staff public.staff; v_dev uuid; v_slot public.jyoban_slots; v_wd date; v_id uuid; v_shared boolean := false; v_check record;
        v_geo record; v_geo_on boolean := false; v_gs text; v_gd double precision;
begin
  v_site := public.jyoban_site_by_token(p_token);

  if p_client_id is not null then
    select r.id, r.work_date, to_char(r.received_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD"T"HH24:MI')
      into v_id, v_wd, received_at from public.jyoban_reports r where r.client_id = p_client_id and r.site_id = v_site.id;
    if v_id is not null then report_id := v_id; work_date := v_wd; duplicate := true; error := null; return next; return; end if;
  end if;

  select d.device_id into v_dev from public.jyoban_staff_by_device(v_site.company_id, p_device_secret) d;
  select st.* into v_staff from public.jyoban_devices dv join public.staff st on st.id = dv.staff_id where dv.id = v_dev;
  if v_staff.id is null then
    if not coalesce(v_site.shared_device_enabled, false) then
      raise exception '本人登録が必要です。スタッフNoとPINで登録してください';
    end if;
    select * into v_check from public.jyoban_verify_pin(v_site.company_id, p_staff_no, p_pin);
    if v_check.error is not null then
      report_id := null; work_date := null; received_at := null; duplicate := false;
      error := public.jyoban_pin_message(v_check.error); return next; return;
    end if;
    select * into v_staff from public.staff st where st.id = v_check.staff_id;
    v_shared := true;
  end if;

  select * into v_slot from public.jyoban_slots j where j.id = p_slot_id and j.site_id = v_site.id;
  if v_slot.id is null then raise exception 'この現場の勤務枠ではありません'; end if;
  v_wd := public.jyoban_work_date(v_slot, public.jyoban_now_local());
  if v_wd is null then raise exception 'いまは「%」の報告を受け付ける時間ではありません', v_slot.name; end if;

  if p_type not in ('wakeup','departure','onduty','offduty','other') then raise exception '報告の種類が不正です'; end if;
  if p_type = 'wakeup' and not coalesce(v_slot.wakeup_required, false) then raise exception 'この勤務枠は起床連絡が不要です'; end if;
  if p_type = 'departure' and not v_slot.departure_required then raise exception 'この勤務枠は出発連絡が不要です'; end if;
  if p_type = 'onduty' and not v_slot.onduty_required then raise exception 'この勤務枠は上番連絡が不要です'; end if;
  if p_type = 'offduty' and not coalesce(v_slot.offduty_required, false) then raise exception 'この勤務枠は下番連絡が不要です'; end if;
  if p_type = 'other' then
    if p_other_kind is null or p_other_kind not in ('late','oversleep','traffic_delay','sick','absent','other') then raise exception '内容を選んでください'; end if;
    if p_other_kind in ('late','oversleep','traffic_delay') and (p_eta is null or p_eta !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
      raise exception '到着見込み時刻を入力してください';
    end if;
    if p_other_kind = 'other' and coalesce(btrim(p_note), '') = '' then raise exception '内容をメモに入力してください'; end if;
  end if;

  -- 起床・出発・上番・下番は1人・1枠・1日1回（取消すれば再報告できる）
  if p_type <> 'other' then
    select r.id, to_char(r.received_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD"T"HH24:MI') into v_id, received_at
      from public.jyoban_reports r
     where r.slot_id = v_slot.id and r.work_date = v_wd and r.type = p_type and r.staff_id = v_staff.id and r.voided_at is null
     order by r.received_at limit 1;
    if v_id is not null then report_id := v_id; work_date := v_wd; duplicate := true; error := null; return next; return; end if;
  end if;

  -- 上番・下番の位置確認（現場が「使わない」なら位置は受け取らない・保存しない）
  if p_type in ('onduty', 'offduty') and coalesce(v_site.geo_mode, 'off') <> 'off' and v_site.geo_lat is not null then
    v_geo_on := true;
    select * into v_geo from public.jyoban_geo_judge(v_site.geo_mode, v_site.geo_lat, v_site.geo_lng, v_site.geo_radius_m, p_lat, p_lng, p_accuracy_m);
    if not v_geo.allowed then raise exception '%', v_geo.message; end if;
    v_gs := v_geo.status; v_gd := v_geo.distance_m;
  end if;

  insert into public.jyoban_reports(company_id, site_id, slot_id, work_date, type, staff_id, staff_no, staff_name,
                                    other_kind, eta, note, client_id, client_at, device_id, via_shared,
                                    geo_lat, geo_lng, geo_accuracy_m, geo_distance_m, geo_status)
    values (v_site.company_id, v_site.id, v_slot.id, v_wd, p_type, v_staff.id, v_staff.staff_no, v_staff.name,
            case when p_type = 'other' then p_other_kind end, case when p_type = 'other' then p_eta end,
            nullif(left(btrim(coalesce(p_note, '')), 500), ''), p_client_id, p_client_at, v_dev, v_shared,
            case when v_gs is not null and v_gs <> 'no_fix' then p_lat end,
            case when v_gs is not null and v_gs <> 'no_fix' then p_lng end,
            case when v_gs is not null and v_gs <> 'no_fix' then least(p_accuracy_m, 100000)::real end,
            least(round(v_gd), 2000000000)::integer,
            v_gs)
    returning id, to_char(jyoban_reports.received_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD"T"HH24:MI') into v_id, received_at;
  report_id := v_id; work_date := v_wd; duplicate := false; error := null; return next;
end $$;

-- ── 6) 会社RPC: 現場の位置確認の設定（管理者・担当の支店のみ）──────────
create or replace function public.company_get_site_geofence(p_site_id uuid)
returns table(mode text, lat double precision, lng double precision, radius_m integer, label text, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.app_can_manage_site(p_site_id) then raise exception 'この現場の設定を見る権限がありません'; end if;
  return query select coalesce(s.geo_mode, 'off'), s.geo_lat, s.geo_lng, coalesce(s.geo_radius_m, 200), s.geo_label, s.geo_updated_at
                 from public.sites s where s.id = p_site_id;
end $$;

create or replace function public.company_set_site_geofence(
  p_site_id uuid, p_mode text, p_lat double precision, p_lng double precision, p_radius_m integer, p_label text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.app_can_manage_site(p_site_id) then raise exception 'この現場の設定を変える権限がありません'; end if;
  if p_mode is null or p_mode not in ('off', 'record', 'required') then raise exception '位置確認の設定が不正です'; end if;
  if (p_lat is null) <> (p_lng is null) then raise exception '緯度と経度は両方入力してください'; end if;
  if p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180) then raise exception '緯度・経度の値が範囲外です'; end if;
  if p_mode <> 'off' and p_lat is null then raise exception '位置確認を使うには、現場の地点を登録してください'; end if;
  if p_radius_m is null or p_radius_m not between 30 and 2000 then raise exception '範囲（半径）は30〜2000mで指定してください'; end if;
  update public.sites
     set geo_mode = p_mode, geo_lat = p_lat, geo_lng = p_lng, geo_radius_m = p_radius_m,
         geo_label = nullif(left(btrim(coalesce(p_label, '')), 200), ''), geo_updated_at = now()
   where id = p_site_id;
end $$;

-- ── 7) 権限 ────────────────────────────────────────────────────────
revoke all on function public.jyoban_geo_distance_m(double precision,double precision,double precision,double precision) from public, anon, authenticated;
revoke all on function public.jyoban_geo_fmt_m(double precision) from public, anon, authenticated;
revoke all on function public.jyoban_geo_judge(text,double precision,double precision,integer,double precision,double precision,double precision) from public, anon, authenticated;
revoke all on function public.jyoban_site_geofence(text) from public;
revoke all on function public.jyoban_submit_report(text,uuid,text,text,text,text,text,text,text,uuid,timestamptz,double precision,double precision,double precision) from public;
revoke all on function public.company_get_site_geofence(uuid) from public, anon;
revoke all on function public.company_set_site_geofence(uuid,text,double precision,double precision,integer,text) from public, anon;
grant execute on function public.jyoban_site_geofence(text) to anon, authenticated;
grant execute on function public.jyoban_submit_report(text,uuid,text,text,text,text,text,text,text,uuid,timestamptz,double precision,double precision,double precision) to anon, authenticated;
grant execute on function public.company_get_site_geofence(uuid) to authenticated;
grant execute on function public.company_set_site_geofence(uuid,text,double precision,double precision,integer,text) to authenticated;
