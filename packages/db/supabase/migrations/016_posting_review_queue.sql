alter table posting_sessions
  add column if not exists clarification_questions_json jsonb not null default '[]'::jsonb,
  add column if not exists review_summary_json jsonb;

alter table posting_sessions
  drop constraint if exists posting_sessions_state_check;

alter table posting_sessions
  add constraint posting_sessions_state_check
    check (
      state in (
        'draft',
        'compiling',
        'ready',
        'needs_input',
        'published',
        'failed'
      )
    );
