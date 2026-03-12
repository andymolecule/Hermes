alter table challenges
  add column if not exists submission_contract_json jsonb default null,
  add column if not exists scoring_env_json jsonb default null;
