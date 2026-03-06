-- Atomic job claiming function using FOR UPDATE SKIP LOCKED.
-- Replaces the two-step SELECT-then-UPDATE pattern in TypeScript.
-- Handles both stale-lease reclaim and fresh claim in one call.

create or replace function claim_next_score_job(
  p_worker_id text,
  p_lease_ms integer default 3600000  -- 60 minutes
)
returns table (
  id uuid,
  submission_id uuid,
  challenge_id uuid,
  status text,
  attempts integer,
  max_attempts integer,
  locked_at timestamptz,
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
  -- Step 1: Reclaim a stale running job (oldest first).
  select sj.id into v_job_id
  from score_jobs sj
  where sj.status = 'running'
    and sj.locked_at < v_stale_cutoff
  order by sj.locked_at asc
  limit 1
  for update skip locked;

  -- Step 2: If no stale job, claim the oldest queued job.
  if v_job_id is null then
    select sj.id into v_job_id
    from score_jobs sj
    where sj.status = 'queued'
    order by sj.created_at asc
    limit 1
    for update skip locked;
  end if;

  -- Nothing available.
  if v_job_id is null then
    return;
  end if;

  -- Step 3: Atomically claim it.
  return query
  update score_jobs sj
  set
    status = 'running',
    attempts = sj.attempts + 1,
    locked_at = now(),
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
    sj.locked_by,
    sj.last_error,
    sj.score_tx_hash,
    sj.created_at,
    sj.updated_at;
end;
$$;
