-- Agora baseline schema after pre-launch testnet reset.
-- Historical incremental migrations were intentionally squashed into this file.

create extension if not exists "pgcrypto";

create table challenges (
  id uuid primary key default gen_random_uuid(),
  chain_id integer not null,
  contract_address text not null,
  factory_address text not null,
  poster_address text not null,
  title text not null,
  description text not null,
  domain text not null,
  challenge_type text not null,
  spec_cid text not null,
  dataset_train_cid text,
  dataset_test_cid text,
  eval_image text not null,
  eval_metric text not null,
  runner_preset_id text not null,
  eval_bundle_cid text,
  expected_columns text[] default null,
  minimum_score numeric,
  max_submissions_total integer,
  max_submissions_per_solver integer,
  reward_amount numeric(20, 6) not null,
  distribution_type text not null,
  deadline timestamptz not null,
  dispute_window_hours integer not null,
  status text not null,
  winning_on_chain_sub_id bigint,
  winner_solver_address text,
  created_at timestamptz not null default now(),
  tx_hash text not null,
  constraint challenges_status_check
    check (status in ('open', 'scoring', 'finalized', 'disputed', 'cancelled')),
  constraint challenges_type_check
    check (
      challenge_type in (
        'reproducibility',
        'prediction',
        'optimization',
        'docking',
        'red_team',
        'custom'
      )
    ),
  constraint challenges_distribution_check
    check (distribution_type in ('winner_take_all', 'top_3', 'proportional')),
  constraint challenges_contract_address_lowercase_check
    check (contract_address = lower(contract_address)),
  constraint challenges_factory_address_lowercase_check
    check (factory_address = lower(factory_address)),
  constraint challenges_poster_address_lowercase_check
    check (poster_address = lower(poster_address)),
  constraint challenges_winner_solver_address_lowercase_check
    check (
      winner_solver_address is null or winner_solver_address = lower(winner_solver_address)
    ),
  constraint challenges_eval_image_check
    check (length(btrim(eval_image)) > 0),
  constraint challenges_eval_metric_check
    check (length(btrim(eval_metric)) > 0),
  constraint challenges_runner_preset_id_check
    check (length(btrim(runner_preset_id)) > 0),
  constraint challenges_reward_amount_check
    check (reward_amount > 0),
  constraint challenges_max_submissions_total_check
    check (max_submissions_total is null or max_submissions_total > 0),
  constraint challenges_max_submissions_per_solver_check
    check (
      max_submissions_per_solver is null or max_submissions_per_solver > 0
    ),
  constraint challenges_submission_limits_check
    check (
      max_submissions_total is null
      or max_submissions_per_solver is null
      or max_submissions_per_solver <= max_submissions_total
    )
);

create unique index idx_challenges_contract_unique
  on challenges(chain_id, contract_address);

create index idx_challenges_status
  on challenges(status);

create index idx_challenges_domain
  on challenges(domain);

create index idx_challenges_deadline
  on challenges(deadline);

create index idx_challenges_poster
  on challenges(poster_address);

create table submissions (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references challenges(id) on delete cascade,
  on_chain_sub_id bigint not null,
  solver_address text not null,
  result_hash text not null,
  result_cid text,
  result_format text not null default 'plain_v0',
  proof_bundle_cid text,
  proof_bundle_hash text,
  score numeric,
  scored boolean not null default false,
  submitted_at timestamptz not null,
  scored_at timestamptz,
  tx_hash text not null,
  constraint submissions_result_format_check
    check (result_format in ('plain_v0', 'sealed_v1')),
  constraint submissions_solver_address_lowercase_check
    check (solver_address = lower(solver_address))
);

create unique index idx_submissions_unique
  on submissions(challenge_id, on_chain_sub_id);

create index idx_submissions_challenge_score
  on submissions(challenge_id, score desc);

create index idx_submissions_challenge_solver
  on submissions(challenge_id, solver_address);

create index idx_submissions_solver_submitted_at
  on submissions(solver_address, submitted_at desc);

create table proof_bundles (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references submissions(id) on delete cascade,
  cid text not null,
  input_hash text not null,
  output_hash text not null,
  container_image_hash text not null,
  scorer_log text,
  reproducible boolean not null default false
);

create table verifications (
  id uuid primary key default gen_random_uuid(),
  proof_bundle_id uuid not null references proof_bundles(id) on delete cascade,
  verifier_address text not null,
  computed_score numeric not null,
  matches_original boolean not null,
  log_cid text,
  verified_at timestamptz not null default now(),
  constraint verifications_verifier_address_lowercase_check
    check (verifier_address = lower(verifier_address))
);

create table challenge_payouts (
  challenge_id uuid not null references challenges(id) on delete cascade,
  solver_address text not null,
  amount numeric(20, 6) not null,
  claimed_at timestamptz,
  claim_tx_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (challenge_id, solver_address),
  constraint challenge_payouts_solver_address_lowercase_check
    check (solver_address = lower(solver_address)),
  constraint challenge_payouts_amount_check
    check (amount >= 0)
);

create index idx_challenge_payouts_solver
  on challenge_payouts(solver_address);

create index idx_challenge_payouts_claimed_at
  on challenge_payouts(claimed_at);

create table indexed_events (
  tx_hash text not null,
  log_index integer not null,
  event_name text not null,
  block_number bigint not null,
  block_hash text,
  processed_at timestamptz not null default now(),
  primary key (tx_hash, log_index)
);

create index idx_indexed_events_block_number
  on indexed_events(block_number desc);

create table indexer_cursors (
  cursor_key text primary key,
  block_number bigint not null,
  updated_at timestamptz not null default now()
);

create index idx_indexer_cursors_updated_at
  on indexer_cursors(updated_at desc);

create table score_jobs (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references submissions(id) on delete cascade,
  challenge_id uuid not null references challenges(id) on delete cascade,
  status text not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  locked_at timestamptz,
  run_started_at timestamptz,
  locked_by text,
  last_error text,
  score_tx_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint score_jobs_status_check
    check (status in ('queued', 'running', 'scored', 'failed', 'skipped')),
  constraint score_jobs_attempts_check
    check (attempts >= 0),
  constraint score_jobs_max_attempts_check
    check (max_attempts >= 0)
);

create index idx_score_jobs_status
  on score_jobs(status);

create table auth_nonces (
  nonce text primary key,
  purpose text not null,
  address text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint auth_nonces_purpose_check
    check (purpose in ('siwe', 'pin_spec')),
  constraint auth_nonces_address_lowercase_check
    check (address is null or address = lower(address))
);

create index idx_auth_nonces_purpose_expires
  on auth_nonces(purpose, expires_at desc);

create index idx_auth_nonces_address
  on auth_nonces(address);

create table auth_sessions (
  token_hash text primary key,
  address text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint auth_sessions_address_lowercase_check
    check (address = lower(address))
);

create index idx_auth_sessions_address
  on auth_sessions(address);

create index idx_auth_sessions_expires
  on auth_sessions(expires_at desc);

alter table submissions enable row level security;
alter table proof_bundles enable row level security;
alter table verifications enable row level security;
alter table score_jobs enable row level security;

create or replace function claim_next_score_job(
  p_worker_id text,
  p_lease_ms integer default 3600000
)
returns table (
  id uuid,
  submission_id uuid,
  challenge_id uuid,
  status text,
  attempts integer,
  max_attempts integer,
  locked_at timestamptz,
  run_started_at timestamptz,
  locked_by text,
  last_error text,
  score_tx_hash text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
as $$
declare
  v_stale_cutoff timestamptz := now() - (p_lease_ms || ' milliseconds')::interval;
  v_job_id uuid;
begin
  select sj.id into v_job_id
  from score_jobs sj
  where sj.status = 'running'
    and sj.locked_at < v_stale_cutoff
  order by sj.locked_at asc
  limit 1
  for update skip locked;

  if v_job_id is null then
    select sj.id into v_job_id
    from score_jobs sj
    join challenges c on c.id = sj.challenge_id
    where sj.status = 'queued'
      and c.status = 'scoring'
    order by sj.created_at asc
    limit 1
    for update of sj skip locked;
  end if;

  if v_job_id is null then
    return;
  end if;

  return query
  update score_jobs sj
  set
    status = 'running',
    attempts = sj.attempts + 1,
    locked_at = now(),
    run_started_at = now(),
    locked_by = p_worker_id,
    updated_at = now()
  where sj.id = v_job_id
  returning
    sj.id,
    sj.submission_id,
    sj.challenge_id,
    sj.status,
    sj.attempts,
    sj.max_attempts,
    sj.locked_at,
    sj.run_started_at,
    sj.locked_by,
    sj.last_error,
    sj.score_tx_hash,
    sj.created_at,
    sj.updated_at;
end;
$$;
