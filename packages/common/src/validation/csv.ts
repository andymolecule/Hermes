/**
 * Lightweight CSV header validation for pre-submission checks.
 *
 * This does NOT replicate the full Docker scorer logic — it catches the 80%
 * case (wrong/missing columns) before the solver spends gas.
 */

export interface CsvHeaderValidationResult {
  valid: boolean;
  missingColumns: string[];
  extraColumns: string[];
}

/**
 * Extract column headers from the first line of a CSV string.
 * Handles quoted headers and trims whitespace.
 */
export function parseCsvHeaders(csvText: string): string[] {
  const firstLine = csvText.split("\n")[0]?.trim();
  if (!firstLine) return [];
  return firstLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
}

/**
 * Validate that a submission CSV contains all expected columns.
 * Extra columns are reported but don't cause failure (scorer ignores them).
 */
export function validateCsvHeaders(
  submissionText: string,
  expectedHeaders: string[],
): CsvHeaderValidationResult {
  const submissionHeaders = parseCsvHeaders(submissionText);
  const missing = expectedHeaders.filter(
    (h) => !submissionHeaders.includes(h),
  );
  const extra = submissionHeaders.filter(
    (h) => !expectedHeaders.includes(h),
  );
  return {
    valid: missing.length === 0,
    missingColumns: missing,
    extraColumns: extra,
  };
}
