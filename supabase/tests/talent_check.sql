-- 0410 人材基盤の検証（使い捨てDBで実行。FAIL を含む行があれば失敗）
insert into groups(id,name) values ('00000000-0000-0000-0000-0000000000a1','HD');
insert into job_roles(group_id,name,is_security) values ('00000000-0000-0000-0000-0000000000a1','警備員',true);
insert into companies(id,name,code,group_id) values ('00000000-0000-0000-0000-0000000000c1','テスト社','t410','00000000-0000-0000-0000-0000000000a1');
do $$ declare r uuid; begin
  select id into r from job_roles limit 1;
  begin
    insert into jobs(company_id,role_id,title,form) values ('00000000-0000-0000-0000-0000000000c1',r,'t','dispatch');
    raise notice 'FAIL: 警備×派遣が通った';
  exception when others then raise notice 'PASS: 警備×派遣は拒否'; end;
  insert into jobs(company_id,role_id,title,form) values ('00000000-0000-0000-0000-0000000000c1',r,'t','security');
  raise notice 'PASS: 警備×直接雇用は登録できる';
  begin
    insert into jobs(company_id,title,form,audience) values ('00000000-0000-0000-0000-0000000000c1','t','spot','public');
    raise notice 'FAIL: 一般公開が通った';
  exception when others then raise notice 'PASS: 一般公開は拒否'; end;
end $$;
