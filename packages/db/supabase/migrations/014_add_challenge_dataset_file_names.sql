alter table challenges
  add column if not exists dataset_train_file_name text,
  add column if not exists dataset_test_file_name text;
