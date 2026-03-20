alter table challenges
  drop column if exists evaluation_json,
  drop column if exists submission_contract_json,
  drop column if exists scoring_env_json;
