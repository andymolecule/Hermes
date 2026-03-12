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
  const firstLine = csvText
    .split(/\r?\n/u)[0]
    ?.replace(/^\uFEFF/u, "")
    .trim();
  if (!firstLine) return [];
  return firstLine
    .split(",")
    .map((header) => header.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
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
  const submissionHeaderSet = new Set(submissionHeaders);
  const expectedHeaderSet = new Set(expectedHeaders);
  const missing = expectedHeaders.filter(
    (header) => !submissionHeaderSet.has(header),
  );
  const extra = submissionHeaders.filter(
    (header) => !expectedHeaderSet.has(header),
  );
  return {
    valid: missing.length === 0,
    missingColumns: missing,
    extraColumns: extra,
  };
}
