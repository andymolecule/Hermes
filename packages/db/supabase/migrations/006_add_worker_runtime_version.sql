alter table if exists worker_runtime_state
  add column if not exists runtime_version text not null default 'unknown';

update worker_runtime_state
set runtime_version = 'unknown'
where runtime_version is null or btrim(runtime_version) = '';
