update score_jobs
set last_error = regexp_replace(
  last_error,
  '^missing_result_cid_onchain_submission',
  'missing_submission_cid_onchain_submission'
)
where last_error like 'missing_result_cid_onchain_submission%';
