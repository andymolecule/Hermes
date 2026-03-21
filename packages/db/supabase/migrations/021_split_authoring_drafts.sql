create table if not exists authoring_drafts (
  id uuid primary key default gen_random_uuid(),
  poster_address text,
  state text not null,
  intent_json jsonb,
  authoring_ir_json jsonb,
  uploaded_artifacts_json jsonb not null default '[]'::jsonb,
  compilation_json jsonb,
  source_callback_url text,
  source_callback_registered_at timestamptz,
  failure_message text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint authoring_drafts_state_check
    check (
      state in (
        'draft',
        'compiling',
        'ready',
        'needs_input',
        'published',
        'failed'
      )
    ),
  constraint authoring_drafts_poster_address_lowercase_check
    check (
      poster_address is null
      or poster_address = lower(poster_address)
    )
);

create index if not exists idx_authoring_drafts_state
  on authoring_drafts(state);

create index if not exists idx_authoring_drafts_expires_at
  on authoring_drafts(expires_at);

create index if not exists idx_authoring_drafts_poster
  on authoring_drafts(poster_address);

create table if not exists published_challenge_links (
  draft_id uuid primary key references authoring_drafts(id) on delete cascade,
  challenge_id uuid references challenges(id) on delete set null,
  published_spec_json jsonb not null,
  published_spec_cid text not null,
  return_to text,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_published_challenge_links_challenge
  on published_challenge_links(challenge_id);

insert into authoring_drafts (
  id,
  poster_address,
  state,
  intent_json,
  authoring_ir_json,
  uploaded_artifacts_json,
  compilation_json,
  source_callback_url,
  source_callback_registered_at,
  failure_message,
  expires_at,
  created_at,
  updated_at
)
select
  posting_sessions.id,
  posting_sessions.poster_address,
  posting_sessions.state,
  posting_sessions.intent_json,
  posting_sessions.authoring_ir_json,
  posting_sessions.uploaded_artifacts_json,
  posting_sessions.compilation_json,
  posting_sessions.source_callback_url,
  posting_sessions.source_callback_registered_at,
  posting_sessions.failure_message,
  posting_sessions.expires_at,
  posting_sessions.created_at,
  posting_sessions.updated_at
from posting_sessions
on conflict (id) do update
set
  poster_address = excluded.poster_address,
  state = excluded.state,
  intent_json = excluded.intent_json,
  authoring_ir_json = excluded.authoring_ir_json,
  uploaded_artifacts_json = excluded.uploaded_artifacts_json,
  compilation_json = excluded.compilation_json,
  source_callback_url = excluded.source_callback_url,
  source_callback_registered_at = excluded.source_callback_registered_at,
  failure_message = excluded.failure_message,
  expires_at = excluded.expires_at,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at;

insert into published_challenge_links (
  draft_id,
  published_spec_json,
  published_spec_cid,
  published_at,
  created_at,
  updated_at
)
select
  posting_sessions.id,
  posting_sessions.published_spec_json,
  posting_sessions.published_spec_cid,
  posting_sessions.updated_at,
  posting_sessions.created_at,
  posting_sessions.updated_at
from posting_sessions
where posting_sessions.published_spec_json is not null
  and posting_sessions.published_spec_cid is not null
on conflict (draft_id) do update
set
  published_spec_json = excluded.published_spec_json,
  published_spec_cid = excluded.published_spec_cid,
  published_at = excluded.published_at,
  updated_at = excluded.updated_at;

alter table authoring_callback_deliveries
  drop constraint if exists authoring_callback_deliveries_draft_id_fkey;

alter table authoring_callback_deliveries
  add constraint authoring_callback_deliveries_draft_id_fkey
  foreign key (draft_id)
  references authoring_drafts(id)
  on delete cascade;
