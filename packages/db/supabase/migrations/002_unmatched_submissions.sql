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
