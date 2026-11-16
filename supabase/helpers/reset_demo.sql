-- デモ用テナントの削除 — Supabase の SQL Editor で実行
-- ------------------------------------------------------------------
-- seed_demo.sql で作ったデモ会社（会社コード DEMO-0001）のデータだけを消す。
-- 会社コードが DEMO- で始まらない会社は消さない（本番データの誤削除防止）。
-- 会社ログイン(/co)の Auth ユーザー自体は消さない。不要なら Authentication → Users で削除する。
-- ------------------------------------------------------------------

do $$
declare
  v_code    text := 'DEMO-0001';
  v_company uuid;
  t record;
  v_pass int;
  v_left int;
begin
  if v_code not like 'DEMO-%' then
    raise exception 'デモ会社（DEMO-で始まるコード）以外は削除できません: %', v_code;
  end if;
  select id into v_company from public.companies where code = v_code;
  if v_company is null then
    raise notice 'デモ会社 % はありません。何もしませんでした', v_code;
    return;
  end if;

  -- company_id を持つ public の表から、この会社の行を消す。
  -- 表どうしの参照順を気にせず済むよう、参照エラーになった表は次の周回で再試行する。
  for v_pass in 1..8 loop
    v_left := 0;
    for t in
      select c.table_name
        from information_schema.columns c
        join information_schema.tables tb
          on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
       where c.table_schema = 'public' and c.column_name = 'company_id'
         and c.table_name not in ('companies', 'app_profiles')
    loop
      begin
        execute format('delete from public.%I where company_id = $1', t.table_name) using v_company;
      exception when foreign_key_violation then
        v_left := v_left + 1;
      end;
    end loop;
    exit when v_left = 0;
  end loop;
  if v_left > 0 then
    raise exception '参照が残っていて消せない表があります（% 件）。内容を確認してください', v_left;
  end if;

  -- 会社ログインの紐付けを外す（Auth ユーザーは残る）
  delete from public.app_profiles where company_id = v_company;
  delete from public.companies where id = v_company;
  raise notice 'デモ会社 % を削除しました', v_code;
end $$;
