create table if not exists submission_intents (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references challenges(id) on delete cascade,
  solver_address text not null,
  result_hash text not null,
  result_cid text not null,
  result_format text not null default 'plain_v0',
  matched_submission_id uuid unique references submissions(id) on delete set null,
  matched_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint submission_intents_result_format_check
    check (result_format in ('plain_v0', 'sealed_submission_v2')),
  constraint submission_intents_solver_address_lowercase_check
    check (solver_address = lower(solver_address))
);

create index if not exists idx_submission_intents_match
  on submission_intents(challenge_id, solver_address, result_hash, created_at);

create index if not exists idx_submission_intents_unmatched_expires
  on submission_intents(expires_at, created_at)
  where matched_submission_id is null;

alter table submission_intents enable row level security;
