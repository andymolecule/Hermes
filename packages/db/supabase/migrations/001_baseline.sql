-- Agora baseline schema after the session-first reset.
-- This file is the only active Supabase migration for fresh environments.

create extension if not exists "pgcrypto";

create table challenges (
  id uuid primary key default gen_random_uuid(),
  chain_id integer not null,
  contract_version integer not null,
  spec_schema_version integer not null,
  factory_challenge_id bigint,
  contract_address text not null,
  factory_address text not null,
  poster_address text not null,
  created_by_agent_id uuid,
  title text not null,
  description text not null,
  domain text not null,
  challenge_type text not null,
  spec_cid text not null,
  execution_plan_json jsonb not null,
  artifacts_json jsonb not null default '[]'::jsonb,
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
  source_provider text,
  source_external_id text,
  source_external_url text,
  source_agent_handle text,
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
  constraint challenges_contract_version_check
    check (contract_version > 0),
  constraint challenges_spec_schema_version_check
    check (spec_schema_version > 0),
  constraint challenges_factory_address_lowercase_check
    check (factory_address = lower(factory_address)),
  constraint challenges_poster_address_lowercase_check
    check (poster_address = lower(poster_address)),
  constraint challenges_winner_solver_address_lowercase_check
    check (
      winner_solver_address is null or winner_solver_address = lower(winner_solver_address)
    ),
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

create index idx_challenges_created_by_agent_id
  on challenges(created_by_agent_id);

create index idx_challenges_source_provider_created_at
  on challenges(source_provider, created_at desc);

create table submission_intents (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references challenges(id) on delete cascade,
  solver_address text not null,
  submitted_by_agent_id uuid,
  result_hash text not null,
  submission_cid text not null,
  expires_at timestamptz not null,
  trace_id text,
  created_at timestamptz not null default now(),
  constraint submission_intents_solver_address_lowercase_check
    check (solver_address = lower(solver_address))
);

create unique index idx_submission_intents_unique_match
  on submission_intents(challenge_id, solver_address, result_hash);

create index idx_submission_intents_expires_created
  on submission_intents(expires_at, created_at);

create index idx_submission_intents_trace_id
  on submission_intents(trace_id)
  where trace_id is not null;

create index idx_submission_intents_submitted_by_agent_id
  on submission_intents(submitted_by_agent_id);

create table submissions (
  id uuid primary key default gen_random_uuid(),
  submission_intent_id uuid not null unique references submission_intents(id) on delete cascade,
  challenge_id uuid not null references challenges(id) on delete cascade,
  on_chain_sub_id bigint not null,
  solver_address text not null,
  result_hash text not null,
  submission_cid text not null,
  proof_bundle_cid text,
  proof_bundle_hash text not null,
  score numeric,
  scored boolean not null default false,
  submitted_at timestamptz not null,
  scored_at timestamptz,
  tx_hash text not null,
  trace_id text,
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

create index idx_submissions_trace_id
  on submissions(trace_id)
  where trace_id is not null;

create table unmatched_submissions (
  challenge_id uuid not null references challenges(id) on delete cascade,
  on_chain_sub_id integer not null,
  solver_address text not null,
  result_hash text not null,
  tx_hash text not null,
  scored boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (challenge_id, on_chain_sub_id),
  constraint unmatched_submissions_solver_address_lowercase_check
    check (solver_address = lower(solver_address))
);

create index idx_unmatched_submissions_match
  on unmatched_submissions(challenge_id, solver_address, result_hash);

create index idx_unmatched_submissions_first_seen
  on unmatched_submissions(first_seen_at);

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
  winning_on_chain_sub_id bigint not null,
  rank integer not null,
  amount numeric(20, 6) not null,
  claimed_at timestamptz,
  claim_tx_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (challenge_id, solver_address, rank),
  constraint challenge_payouts_solver_address_lowercase_check
    check (solver_address = lower(solver_address)),
  constraint challenge_payouts_rank_check
    check (rank > 0),
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
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  run_started_at timestamptz,
  locked_by text,
  last_error text,
  score_tx_hash text,
  trace_id text,
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

create index idx_score_jobs_status_next_attempt_at
  on score_jobs(status, next_attempt_at);

create index idx_score_jobs_trace_id
  on score_jobs(trace_id)
  where trace_id is not null;

create table worker_runtime_state (
  worker_id text primary key,
  worker_type text not null,
  host text,
  runtime_version text not null default 'unknown',
  ready boolean not null default false,
  executor_ready boolean not null default false,
  seal_enabled boolean not null default false,
  seal_key_id text,
  seal_self_check_ok boolean not null default false,
  last_error text,
  started_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worker_runtime_state_worker_type_check
    check (worker_type in ('scoring'))
);

create index idx_worker_runtime_state_type_heartbeat
  on worker_runtime_state(worker_type, last_heartbeat_at desc);

create table worker_runtime_control (
  worker_type text primary key,
  active_runtime_version text not null,
  updated_at timestamptz not null default now(),
  constraint worker_runtime_control_worker_type_check
    check (worker_type in ('scoring'))
);

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

create table auth_agents (
  id uuid primary key default gen_random_uuid(),
  telegram_bot_id text not null unique,
  agent_name text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table auth_agent_keys (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references auth_agents(id) on delete cascade,
  key_label text,
  api_key_hash text not null unique,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index idx_auth_agent_keys_agent_id
  on auth_agent_keys(agent_id);

create index idx_auth_agent_keys_api_key_hash
  on auth_agent_keys(api_key_hash);

alter table challenges
  add constraint challenges_created_by_agent_id_fkey
  foreign key (created_by_agent_id) references auth_agents(id);

alter table submission_intents
  add constraint submission_intents_submitted_by_agent_id_fkey
  foreign key (submitted_by_agent_id) references auth_agents(id);

create table authoring_sessions (
  id uuid primary key default gen_random_uuid(),
  poster_address text,
  created_by_agent_id uuid references auth_agents(id),
  state text not null,
  intent_json jsonb,
  authoring_ir_json jsonb,
  uploaded_artifacts_json jsonb not null default '[]'::jsonb,
  compilation_json jsonb,
  conversation_log_json jsonb not null default '[]'::jsonb,
  published_challenge_id uuid references challenges(id) on delete set null,
  published_spec_json jsonb,
  published_spec_cid text,
  published_at timestamptz,
  failure_message text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint authoring_sessions_state_check
    check (
      state in (
        'created',
        'awaiting_input',
        'ready',
        'published',
        'rejected',
        'expired'
      )
    ),
  constraint authoring_sessions_poster_address_lowercase_check
    check (
      poster_address is null
      or poster_address = lower(poster_address)
    ),
  constraint authoring_sessions_creator_identity_check
    check (
      (poster_address is not null and created_by_agent_id is null)
      or (poster_address is null and created_by_agent_id is not null)
    )
);

create index idx_authoring_sessions_state
  on authoring_sessions(state);

create index idx_authoring_sessions_expires_at
  on authoring_sessions(expires_at);

create index idx_authoring_sessions_poster
  on authoring_sessions(poster_address);

create index idx_authoring_sessions_published_challenge
  on authoring_sessions(published_challenge_id);

create index idx_authoring_sessions_created_by_agent_id
  on authoring_sessions(created_by_agent_id);

create or replace function append_authoring_session_conversation_log(
  p_session_id uuid,
  p_entries jsonb,
  p_expected_updated_at timestamptz default null
)
returns setof authoring_sessions
language plpgsql
as $$
begin
  return query
  update authoring_sessions
  set
    conversation_log_json =
      coalesce(conversation_log_json, '[]'::jsonb) ||
      coalesce(p_entries, '[]'::jsonb),
    updated_at = now()
  where id = p_session_id
    and (
      p_expected_updated_at is null
      or updated_at = p_expected_updated_at
    )
  returning *;
end;
$$;

create table authoring_sponsor_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references authoring_sessions(id) on delete cascade,
  provider text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  amount_usdc numeric(20, 6) not null,
  status text not null default 'reserved',
  tx_hash text,
  challenge_id uuid references challenges(id) on delete set null,
  reserved_at timestamptz not null default now(),
  released_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint authoring_sponsor_budget_reservations_status_check
    check (status in ('reserved', 'consumed', 'released')),
  constraint authoring_sponsor_budget_reservations_amount_check
    check (amount_usdc > 0),
  constraint authoring_sponsor_budget_reservations_provider_check
    check (length(btrim(provider)) > 0),
  constraint authoring_sponsor_budget_reservations_period_check
    check (period_end > period_start)
);

create index idx_authoring_sponsor_budget_reservations_period
  on authoring_sponsor_budget_reservations(provider, period_start, period_end, status);

create index idx_authoring_sponsor_budget_reservations_tx_hash
  on authoring_sponsor_budget_reservations(tx_hash);

alter table submission_intents enable row level security;
alter table submissions enable row level security;
alter table proof_bundles enable row level security;
alter table verifications enable row level security;
alter table score_jobs enable row level security;
alter table worker_runtime_state enable row level security;
alter table worker_runtime_control enable row level security;

create or replace function claim_next_score_job(
  p_worker_id text,
  p_lease_ms integer default 3600000,
  p_chain_id integer default null
)
returns table (
  id uuid,
  submission_id uuid,
  challenge_id uuid,
  status text,
  attempts integer,
  max_attempts integer,
  next_attempt_at timestamptz,
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
  v_active_runtime_version text;
  v_worker_runtime_version text;
begin
  select wrc.active_runtime_version
    into v_active_runtime_version
  from worker_runtime_control wrc
  where wrc.worker_type = 'scoring'
  limit 1;

  select wrs.runtime_version
    into v_worker_runtime_version
  from worker_runtime_state wrs
  where wrs.worker_id = p_worker_id
    and wrs.worker_type = 'scoring'
  limit 1;

  if v_active_runtime_version is not null
     and v_worker_runtime_version is distinct from v_active_runtime_version then
    return;
  end if;

  select sj.id into v_job_id
  from score_jobs sj
  join challenges c on c.id = sj.challenge_id
  where sj.status = 'running'
    and sj.locked_at < v_stale_cutoff
    and (p_chain_id is null or c.chain_id = p_chain_id)
  order by sj.locked_at asc
  limit 1
  for update of sj skip locked;

  if v_job_id is null then
    select sj.id into v_job_id
    from score_jobs sj
    join challenges c on c.id = sj.challenge_id
    where sj.status = 'queued'
      and c.status = 'scoring'
      and sj.next_attempt_at <= now()
      and (p_chain_id is null or c.chain_id = p_chain_id)
    order by sj.next_attempt_at asc, sj.created_at asc
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
    sj.next_attempt_at,
    sj.locked_at,
    sj.run_started_at,
    sj.locked_by,
    sj.last_error,
    sj.score_tx_hash,
    sj.created_at,
    sj.updated_at;
end;
$$;

create or replace function replace_challenge_payouts(
  p_challenge_id uuid,
  p_payouts jsonb default '[]'::jsonb
)
returns table (
  challenge_id uuid,
  solver_address text,
  winning_on_chain_sub_id bigint,
  rank integer,
  amount numeric(20, 6),
  claimed_at timestamptz,
  claim_tx_hash text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
as $$
begin
  delete from challenge_payouts as cp
  where cp.challenge_id = p_challenge_id;

  if p_payouts is null
     or jsonb_typeof(p_payouts) <> 'array'
     or jsonb_array_length(p_payouts) = 0 then
    return;
  end if;

  return query
  insert into challenge_payouts (
    challenge_id,
    solver_address,
    winning_on_chain_sub_id,
    rank,
    amount,
    claimed_at,
    claim_tx_hash
  )
  select
    p_challenge_id,
    lower(row_payload.solver_address),
    row_payload.winning_on_chain_sub_id,
    row_payload.rank,
    row_payload.amount,
    row_payload.claimed_at,
    row_payload.claim_tx_hash
  from jsonb_to_recordset(p_payouts) as row_payload(
    solver_address text,
    winning_on_chain_sub_id bigint,
    rank integer,
    amount numeric(20, 6),
    claimed_at timestamptz,
    claim_tx_hash text
  )
  returning
    challenge_payouts.challenge_id,
    challenge_payouts.solver_address,
    challenge_payouts.winning_on_chain_sub_id,
    challenge_payouts.rank,
    challenge_payouts.amount,
    challenge_payouts.claimed_at,
    challenge_payouts.claim_tx_hash,
    challenge_payouts.created_at,
    challenge_payouts.updated_at;
end;
$$;

create or replace function reserve_authoring_sponsor_budget(
  p_session_id uuid,
  p_provider text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_amount_usdc numeric,
  p_budget_limit_usdc numeric
)
returns authoring_sponsor_budget_reservations
language plpgsql
as $$
declare
  v_reservation authoring_sponsor_budget_reservations;
  v_consumed numeric(20, 6);
  v_reserved numeric(20, 6);
begin
  if p_amount_usdc is null or p_amount_usdc <= 0 then
    raise exception
      'Authoring sponsor budget reservation amount must be positive.'
      using errcode = '22003';
  end if;

  if p_budget_limit_usdc is null or p_budget_limit_usdc <= 0 then
    raise exception
      'Authoring sponsor budget limit must be positive.'
      using errcode = '22003';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      lower(coalesce(p_provider, '')) || '|' || p_period_start::text || '|' || p_period_end::text,
      0
    )
  );

  select *
  into v_reservation
  from authoring_sponsor_budget_reservations
  where session_id = p_session_id
  for update;

  if found and v_reservation.status = 'consumed' then
    return v_reservation;
  end if;

  if found then
    update authoring_sponsor_budget_reservations
    set
      provider = p_provider,
      period_start = p_period_start,
      period_end = p_period_end,
      amount_usdc = p_amount_usdc,
      status = 'reserved',
      released_at = null,
      updated_at = now()
    where session_id = p_session_id
    returning * into v_reservation;
  else
    insert into authoring_sponsor_budget_reservations (
      session_id,
      provider,
      period_start,
      period_end,
      amount_usdc,
      status
    )
    values (
      p_session_id,
      p_provider,
      p_period_start,
      p_period_end,
      p_amount_usdc,
      'reserved'
    )
    returning * into v_reservation;
  end if;

  select coalesce(sum(reward_amount), 0)
  into v_consumed
  from challenges
  where source_provider = p_provider
    and created_at >= p_period_start
    and created_at < p_period_end;

  select coalesce(sum(amount_usdc), 0)
  into v_reserved
  from authoring_sponsor_budget_reservations
  where provider = p_provider
    and period_start = p_period_start
    and period_end = p_period_end
    and status = 'reserved'
    and session_id <> p_session_id;

  if v_consumed + v_reserved + v_reservation.amount_usdc > p_budget_limit_usdc then
    raise exception
      'Agora sponsor budget for provider % would be exceeded. Next step: lower the reward, wait for the next budget window, or raise the sponsor cap and retry.',
      p_provider
      using errcode = 'P0001';
  end if;

  return v_reservation;
end;
$$;
