import { z } from "zod";
import { SUBMISSION_LIMITS } from "../constants.js";
import { parseCsvHeaders, validateCsvHeaders } from "../validation/csv.js";

const csvExtensionSchema = z.literal(".csv");
const csvMimeSchema = z.literal("text/csv");

const baseFileContractSchema = z.object({
  max_bytes: z
    .number()
    .int()
    .positive()
    .max(SUBMISSION_LIMITS.maxUploadBytes)
    .default(SUBMISSION_LIMITS.maxUploadBytes),
});

export const csvTableSubmissionContractSchema = z
  .object({
    version: z.literal("v1"),
    kind: z.literal("csv_table"),
    file: baseFileContractSchema.extend({
      extension: csvExtensionSchema.default(".csv"),
      mime: csvMimeSchema.default("text/csv"),
    }),
    columns: z
      .object({
        required: z.array(z.string().min(1)).min(1),
        id: z.string().min(1).optional(),
        value: z.string().min(1).optional(),
        allow_extra: z.boolean().default(true),
      })
      .superRefine((value, ctx) => {
        const required = new Set(value.required);
        if (value.id && !required.has(value.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["id"],
            message: "columns.id must also appear in columns.required.",
          });
        }
        if (value.value && !required.has(value.value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["value"],
            message: "columns.value must also appear in columns.required.",
          });
        }
      }),
  })
  .superRefine((value, ctx) => {
    if (value.file.max_bytes > SUBMISSION_LIMITS.maxUploadBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: SUBMISSION_LIMITS.maxUploadBytes,
        inclusive: true,
        type: "number",
        path: ["file", "max_bytes"],
        message: `CSV submission max_bytes cannot exceed ${SUBMISSION_LIMITS.maxUploadBytes}.`,
      });
    }
  });

export const opaqueFileSubmissionContractSchema = z.object({
  version: z.literal("v1"),
  kind: z.literal("opaque_file"),
  file: baseFileContractSchema.extend({
    extension: z.string().min(1).optional(),
    mime: z.string().min(1).optional(),
  }),
});

export const submissionContractSchema = z.union([
  csvTableSubmissionContractSchema,
  opaqueFileSubmissionContractSchema,
]);

export type CsvTableSubmissionContract = z.output<
  typeof csvTableSubmissionContractSchema
>;
export type OpaqueFileSubmissionContract = z.output<
  typeof opaqueFileSubmissionContractSchema
>;
export type SubmissionContractOutput = z.output<
  typeof submissionContractSchema
>;
export type SubmissionContractInput = z.input<typeof submissionContractSchema>;

export function createCsvTableSubmissionContract(input: {
  requiredColumns: string[];
  idColumn?: string;
  valueColumn?: string;
  allowExtraColumns?: boolean;
  maxBytes?: number;
}): CsvTableSubmissionContract {
  return csvTableSubmissionContractSchema.parse({
    version: "v1",
    kind: "csv_table",
    file: {
      extension: ".csv",
      mime: "text/csv",
      max_bytes: input.maxBytes ?? SUBMISSION_LIMITS.maxUploadBytes,
    },
    columns: {
      required: input.requiredColumns,
      ...(input.idColumn ? { id: input.idColumn } : {}),
      ...(input.valueColumn ? { value: input.valueColumn } : {}),
      allow_extra: input.allowExtraColumns ?? true,
    },
  });
}

export function createOpaqueFileSubmissionContract(
  input: {
    extension?: string;
    mime?: string;
    maxBytes?: number;
  } = {},
): OpaqueFileSubmissionContract {
  return opaqueFileSubmissionContractSchema.parse({
    version: "v1",
    kind: "opaque_file",
    file: {
      ...(input.extension ? { extension: input.extension } : {}),
      ...(input.mime ? { mime: input.mime } : {}),
      max_bytes: input.maxBytes ?? SUBMISSION_LIMITS.maxUploadBytes,
    },
  });
}

export function deriveExpectedColumns(
  submissionContract?: SubmissionContractOutput | null,
): string[] {
  if (!submissionContract || submissionContract.kind !== "csv_table") {
    return [];
  }
  return submissionContract.columns.required;
}

export function isFileOnlySubmissionContract(
  submissionContract?: SubmissionContractOutput | null,
): boolean {
  return Boolean(submissionContract);
}

export function describeSubmissionArtifact(
  submissionContract?: SubmissionContractOutput | null,
): string {
  if (!submissionContract) {
    return "solution file";
  }
  if (submissionContract.kind === "csv_table") {
    return "CSV file";
  }
  if (submissionContract.file.extension) {
    return `${submissionContract.file.extension} file`;
  }
  return "file upload";
}

export interface SubmissionContractValidationResult {
  valid: boolean;
  message?: string;
  missingColumns?: string[];
  extraColumns?: string[];
  presentColumns?: string[];
}

export function validateSubmissionTextAgainstContract(
  content: string,
  submissionContract?: SubmissionContractOutput | null,
): SubmissionContractValidationResult {
  if (!submissionContract) {
    return { valid: true };
  }

  if (submissionContract.kind !== "csv_table") {
    return { valid: true };
  }

  const presentColumns = parseCsvHeaders(content);
  const requiredColumns = submissionContract.columns.required;
  const validation = validateCsvHeaders(content, requiredColumns);
  const extraColumns = submissionContract.columns.allow_extra
    ? []
    : presentColumns.filter((column) => !requiredColumns.includes(column));

  if (validation.valid && extraColumns.length === 0) {
    return { valid: true };
  }

  const messageParts = [
    `Submission does not match the challenge CSV contract. Next step: upload a CSV file with columns: ${requiredColumns.join(", ")}.`,
  ];
  if (!validation.valid && validation.missingColumns.length > 0) {
    messageParts.push(`Missing: ${validation.missingColumns.join(", ")}.`);
  }
  if (extraColumns.length > 0) {
    messageParts.push(
      `Unexpected columns: ${extraColumns.join(", ")}. Remove extra columns and retry.`,
    );
  }
  if (presentColumns.length > 0) {
    messageParts.push(`Uploaded columns: ${presentColumns.join(", ")}.`);
  } else {
    messageParts.push(
      "Uploaded columns could not be read. Save the file as UTF-8 CSV and retry.",
    );
  }

  return {
    valid: false,
    message: messageParts.join(" "),
    missingColumns: validation.valid ? [] : validation.missingColumns,
    extraColumns,
    presentColumns,
  };
}

export function validateSubmissionBytesAgainstContract(
  bytes: Uint8Array,
  submissionContract?: SubmissionContractOutput | null,
): SubmissionContractValidationResult {
  if (!submissionContract || submissionContract.kind !== "csv_table") {
    return { valid: true };
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return {
      valid: false,
      message:
        "Submission is not valid UTF-8 CSV text. Next step: upload a UTF-8 encoded .csv file and retry.",
    };
  }

  return validateSubmissionTextAgainstContract(text, submissionContract);
}
