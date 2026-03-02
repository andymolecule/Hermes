-- Score jobs table for automated worker scoring
create table if not exists score_jobs (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  challenge_id uuid not null references challenges(id) on delete cascade,
  status text not null default 'queued',       -- queued | running | scored | failed
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  locked_at timestamptz,
  locked_by text,                              -- worker instance id
  last_error text,
  score_tx_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_score_jobs_submission on score_jobs(submission_id);
create index if not exists idx_score_jobs_status on score_jobs(status);
