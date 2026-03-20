alter table challenges
  add column if not exists evaluation_plan_json jsonb;
