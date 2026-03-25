alter table submission_intents
  drop constraint if exists submission_intents_result_format_check;

alter table submissions
  drop constraint if exists submissions_result_format_check;

alter table submission_intents
  drop column if exists result_format;

alter table submissions
  drop column if exists result_format;
