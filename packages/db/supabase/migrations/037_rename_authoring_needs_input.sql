update authoring_drafts
set
  state = 'needs_input',
  updated_at = now()
where state = 'needs_clarification';

alter table authoring_drafts
  drop constraint if exists authoring_drafts_state_check;

alter table authoring_drafts
  add constraint authoring_drafts_state_check
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
