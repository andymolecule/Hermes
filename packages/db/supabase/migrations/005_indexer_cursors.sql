create table if not exists indexer_cursors (
  cursor_key text primary key,
  block_number bigint not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_indexer_cursors_updated_at
  on indexer_cursors(updated_at desc);
