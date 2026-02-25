-- Hermes initial schema
create extension if not exists "pgcrypto";

create table if not exists challenges (
  id uuid primary key default gen_random_uuid(),
  chain_id integer not null,
  contract_address text not null,
  factory_challenge_id bigint not null,
  poster_address text not null,
  title text not null,
  description text not null,
  domain text not null,
  challenge_type text not null,
  spec_cid text not null,
  dataset_train_cid text,
  dataset_test_cid text,
  scoring_container text not null,
  scoring_metric text not null,
  minimum_score numeric,
  reward_amount numeric(20, 6) not null,
  distribution_type text not null,
  deadline timestamptz not null,
  dispute_window_hours integer not null,
  max_submissions_per_wallet integer not null,
  status text not null,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  winner_submission_id uuid,
  tx_hash text not null
);

create unique index if not exists idx_challenges_unique on challenges(chain_id, factory_challenge_id);
create index if not exists idx_challenges_status on challenges(status);
create index if not exists idx_challenges_domain on challenges(domain);
create index if not exists idx_challenges_deadline on challenges(deadline);
create index if not exists idx_challenges_poster on challenges(poster_address);

create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references challenges(id) on delete cascade,
  on_chain_sub_id bigint not null,
  solver_address text not null,
  result_hash text not null,
  result_cid text,
  proof_bundle_cid text,
  proof_bundle_hash text,
  score numeric,
  scored boolean not null default false,
  submitted_at timestamptz not null,
  scored_at timestamptz,
  rank integer,
  tx_hash text not null
);

create unique index if not exists idx_submissions_unique on submissions(challenge_id, on_chain_sub_id);
create index if not exists idx_submissions_challenge_score on submissions(challenge_id, score desc);

create table if not exists proof_bundles (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  cid text not null,
  input_hash text not null,
  output_hash text not null,
  container_image_hash text not null,
  scorer_log text,
  reproducible boolean not null default false,
  verified_count integer not null default 0
);

create table if not exists verifications (
  id uuid primary key default gen_random_uuid(),
  proof_bundle_id uuid not null references proof_bundles(id) on delete cascade,
  verifier_address text not null,
  computed_score numeric not null,
  matches_original boolean not null,
  log_cid text,
  verified_at timestamptz not null default now()
);

create table if not exists indexed_events (
  tx_hash text not null,
  log_index integer not null,
  event_name text not null,
  block_number bigint not null,
  processed_at timestamptz not null default now(),
  primary key (tx_hash, log_index)
);
