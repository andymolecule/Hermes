do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'submission_intents'
      and column_name = 'result_cid'
  ) then
    execute 'alter table submission_intents rename column result_cid to submission_cid';
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'submissions'
      and column_name = 'result_cid'
  ) then
    execute 'alter table submissions rename column result_cid to submission_cid';
  end if;
end
$$;
