import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AgoraError,
  type AuthoringArtifactOutput,
  SUBMISSION_LIMITS,
  parseCsvHeaders,
} from "@agora/common";
import { pinFile } from "@agora/ipfs";

const AUTHORING_UPLOAD_MAX_BYTES = SUBMISSION_LIMITS.maxUploadBytes;
const CSV_MIME_TYPES = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
]);

function normalizeUploadFileName(fileName: string | null | undefined) {
  const normalized = path.basename(fileName ?? "authoring-upload.bin").trim();
  return normalized.length > 0 ? normalized : "authoring-upload.bin";
}

function buildUploadArtifactId(input: { uri: string; fileName: string }) {
  return `upload-${createHash("sha256").update(`${input.uri}:${input.fileName}`).digest("hex").slice(0, 12)}`;
}

function shouldParseCsv(input: { fileName: string; mimeType?: string | null }) {
  const normalizedMimeType = input.mimeType?.trim().toLowerCase() ?? null;
  if (normalizedMimeType && CSV_MIME_TYPES.has(normalizedMimeType)) {
    return true;
  }
  return input.fileName.toLowerCase().endsWith(".csv");
}

function detectColumns(input: {
  bytes: Uint8Array;
  fileName: string;
  mimeType?: string | null;
}) {
  if (!shouldParseCsv(input)) {
    return undefined;
  }

  try {
    return parseCsvHeaders(new TextDecoder().decode(input.bytes));
  } catch {
    return undefined;
  }
}

export async function pinAuthoringUpload(input: {
  bytes: Uint8Array;
  fileName: string | null | undefined;
  mimeType?: string | null;
  pinFileImpl?: typeof pinFile;
}) {
  const safeFileName = normalizeUploadFileName(input.fileName);
  if (input.bytes.byteLength === 0) {
    throw new AgoraError(
      "Authoring upload requires a non-empty file. Next step: attach the file bytes and retry.",
      {
        status: 400,
        code: "AUTHORING_UPLOAD_MISSING_FILE",
      },
    );
  }
  if (input.bytes.byteLength > AUTHORING_UPLOAD_MAX_BYTES) {
    throw new AgoraError(
      `Authoring upload exceeds the ${AUTHORING_UPLOAD_MAX_BYTES / 1024 / 1024}MB limit. Next step: shrink the file and retry.`,
      {
        status: 413,
        code: "AUTHORING_UPLOAD_TOO_LARGE",
      },
    );
  }

  let tempDir: string | null = null;
  let tempFilePath: string | null = null;
  try {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agora-authoring-"));
    tempFilePath = path.join(tempDir, `${randomUUID()}-${safeFileName}`);
    await fs.writeFile(tempFilePath, Buffer.from(input.bytes));
    const uri = await (input.pinFileImpl ?? pinFile)(
      tempFilePath,
      safeFileName,
    );
    return {
      id: buildUploadArtifactId({ uri, fileName: safeFileName }),
      uri,
      file_name: safeFileName,
      mime_type: input.mimeType?.trim() || undefined,
      size_bytes: input.bytes.byteLength,
      detected_columns: detectColumns({
        bytes: input.bytes,
        fileName: safeFileName,
        mimeType: input.mimeType,
      }),
    } satisfies AuthoringArtifactOutput;
  } catch (error) {
    throw new AgoraError(
      error instanceof Error
        ? `Authoring upload failed: ${error.message}. Next step: retry, then inspect API IPFS credentials if the error persists.`
        : "Authoring upload failed. Next step: retry, then inspect API IPFS credentials if the error persists.",
      {
        status: 500,
        code: "AUTHORING_UPLOAD_FAILED",
        retriable: true,
        cause: error,
      },
    );
  } finally {
    if (tempFilePath) {
      await fs.rm(tempFilePath, { force: true });
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}
