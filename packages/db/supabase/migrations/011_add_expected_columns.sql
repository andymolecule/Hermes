-- Add expected_columns to challenges for pre-submission CSV header validation.
-- Nullable: only populated for CSV-based challenges with a dataset_test_cid.
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS expected_columns text[] DEFAULT NULL;
