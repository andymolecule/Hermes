import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AgoraError,
  type AuthoringArtifactOutput,
  type AuthoringSourceSessionInputOutput,
  SUBMISSION_LIMITS,
} from "@agora/common";
import { pinFile, unpinCid } from "@agora/ipfs";

const AUTHORING_ARTIFACT_FETCH_TIMEOUT_MS = 15_000;
const AUTHORING_ARTIFACT_MAX_BYTES = SUBMISSION_LIMITS.maxUploadBytes;
const AUTHORING_ARTIFACT_FALLBACK_NAME = "external-artifact";

function buildExternalArtifactId(sourceUrl: string) {
  return `external-${createHash("sha256").update(sourceUrl).digest("hex").slice(0, 12)}`;
}

function normalizeFileName(fileName: string | null | undefined) {
  const normalized = path
    .basename(fileName ?? AUTHORING_ARTIFACT_FALLBACK_NAME)
    .trim();
  return normalized.length > 0 ? normalized : AUTHORING_ARTIFACT_FALLBACK_NAME;
}

function extractFileNameFromUrl(sourceUrl: string) {
  try {
    const parsed = new URL(sourceUrl);
    const lastSegment = parsed.pathname.split("/").pop()?.trim();
    return lastSegment && lastSegment.length > 0 ? lastSegment : null;
  } catch {
    return null;
  }
}

function extractFileNameFromContentDisposition(headerValue: string | null) {
  if (!headerValue) {
    return null;
  }

  const utf8Match = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(headerValue);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const plainMatch = /filename\s*=\s*"?(?<name>[^";]+)"?/i.exec(headerValue);
  return plainMatch?.groups?.name ?? null;
}

function normalizeMimeType(value: string | null | undefined) {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const [type] = trimmed.split(";");
  return type?.trim() || null;
}

function isCsvLikeArtifact(input: {
  fileName: string;
  mimeType?: string | null;
}) {
  const normalizedMime = normalizeMimeType(input.mimeType);
  return (
    input.fileName.trim().toLowerCase().endsWith(".csv") ||
    normalizedMime === "text/csv" ||
    normalizedMime === "application/csv"
  );
}

function splitCsvHeaderRow(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      const nextChar = line[index + 1];
      if (quoted && nextChar === '"') {
        current += '"';
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

export function detectAuthoringArtifactColumns(input: {
  bytes: Uint8Array;
  fileName: string;
  mimeType?: string | null;
}) {
  if (!isCsvLikeArtifact(input)) {
    return undefined;
  }

  const text = new TextDecoder("utf8", { fatal: false }).decode(input.bytes);
  const firstLine = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return undefined;
  }

  const columns = splitCsvHeaderRow(firstLine).filter(
    (column) => column.length > 0,
  );
  return columns.length > 0 ? columns : undefined;
}

function artifactFetchError(input: {
  code: string;
  message: string;
  status: number;
  retriable?: boolean;
  details?: Record<string, unknown>;
  cause?: unknown;
}) {
  return new AgoraError(input.message, {
    code: input.code,
    status: input.status,
    retriable: input.retriable,
    details: input.details,
    cause: input.cause,
  });
}

async function readResponseBytes(input: {
  response: Response;
  sourceUrl: string;
  maxBytes: number;
}) {
  const declaredLength = Number(input.response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > input.maxBytes) {
    throw artifactFetchError({
      code: "AUTHORING_SOURCE_ARTIFACT_TOO_LARGE",
      status: 413,
      message: `External artifact exceeds the ${Math.floor(input.maxBytes / 1024 / 1024)}MB ingest limit. Next step: shrink the source file or provide a smaller artifact URL and retry.`,
      details: {
        source_url: input.sourceUrl,
        content_length: declaredLength,
        maximum_bytes: input.maxBytes,
      },
    });
  }

  const body = input.response.body;
  if (!body) {
    return new Uint8Array(await input.response.arrayBuffer());
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }

    totalBytes += value.byteLength;
    if (totalBytes > input.maxBytes) {
      throw artifactFetchError({
        code: "AUTHORING_SOURCE_ARTIFACT_TOO_LARGE",
        status: 413,
        message: `External artifact exceeds the ${Math.floor(input.maxBytes / 1024 / 1024)}MB ingest limit. Next step: shrink the source file or provide a smaller artifact URL and retry.`,
        details: {
          source_url: input.sourceUrl,
          maximum_bytes: input.maxBytes,
        },
      });
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchExternalArtifact(input: {
  artifact: NonNullable<
    AuthoringSourceSessionInputOutput["artifacts"]
  >[number];
  fetchImpl?: typeof fetch;
  fetchTimeoutMs?: number;
  maxBytes?: number;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.fetchTimeoutMs ?? AUTHORING_ARTIFACT_FETCH_TIMEOUT_MS;
  let response: Response;

  try {
    response = await fetchImpl(input.artifact.source_url, {
      method: "GET",
      // Reject redirects so external hosts cannot bounce artifact fetches onto
      // private network targets through open-redirect chains.
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    throw artifactFetchError({
      code: "AUTHORING_SOURCE_ARTIFACT_FETCH_FAILED",
      status: 502,
      retriable: true,
      message: isAbort
        ? `Fetching the external artifact timed out after ${timeoutMs}ms. Next step: verify the source host is reachable and retry.`
        : "Fetching the external artifact failed. Next step: verify the source host is reachable and retry.",
      details: {
        source_url: input.artifact.source_url,
      },
      cause: error,
    });
  }

  if (!response.ok) {
    throw artifactFetchError({
      code: "AUTHORING_SOURCE_ARTIFACT_FETCH_FAILED",
      status: response.status >= 500 || response.status === 429 ? 502 : 422,
      retriable: response.status >= 500 || response.status === 429,
      message:
        response.status >= 500 || response.status === 429
          ? "Fetching the external artifact failed upstream. Next step: retry, then inspect the source host if the error persists."
          : "External artifact URL could not be fetched. Next step: verify the source URL is correct and publicly reachable, then retry.",
      details: {
        source_url: input.artifact.source_url,
        upstream_status: response.status,
      },
    });
  }

  const responseMimeType = normalizeMimeType(
    response.headers.get("content-type"),
  );
  const expectedMimeType = normalizeMimeType(input.artifact.mime_type);
  if (
    expectedMimeType &&
    responseMimeType &&
    responseMimeType !== expectedMimeType &&
    responseMimeType !== "application/octet-stream"
  ) {
    throw artifactFetchError({
      code: "AUTHORING_SOURCE_ARTIFACT_TYPE_MISMATCH",
      status: 422,
      message:
        "External artifact content-type did not match the declared mime_type. Next step: correct the artifact metadata or source file and retry.",
      details: {
        source_url: input.artifact.source_url,
        expected_mime_type: expectedMimeType,
        actual_mime_type: responseMimeType,
      },
    });
  }

  const bytes = await readResponseBytes({
    response,
    sourceUrl: input.artifact.source_url,
    maxBytes: input.maxBytes ?? AUTHORING_ARTIFACT_MAX_BYTES,
  });
  if (bytes.byteLength === 0) {
    throw artifactFetchError({
      code: "AUTHORING_SOURCE_ARTIFACT_EMPTY",
      status: 422,
      message:
        "External artifact was empty. Next step: provide a non-empty source file and retry.",
      details: {
        source_url: input.artifact.source_url,
      },
    });
  }

  const fileName = normalizeFileName(
    input.artifact.suggested_filename ??
      extractFileNameFromContentDisposition(
        response.headers.get("content-disposition"),
      ) ??
      extractFileNameFromUrl(input.artifact.source_url),
  );

  return {
    bytes,
    fileName,
    mimeType: expectedMimeType ?? responseMimeType ?? undefined,
  };
}

async function rollbackPinnedArtifacts(
  pinnedUris: string[],
  unpinCidImpl: typeof unpinCid,
) {
  await Promise.allSettled(
    pinnedUris.map(async (uri) => {
      try {
        await unpinCidImpl(uri);
      } catch {
        // Best-effort rollback only. Preserve the original normalization error.
      }
    }),
  );
}

export async function normalizeExternalArtifactsForDraft(input: {
  artifacts: AuthoringSourceSessionInputOutput["artifacts"];
  fetchImpl?: typeof fetch;
  pinFileImpl?: typeof pinFile;
  unpinCidImpl?: typeof unpinCid;
  fetchTimeoutMs?: number;
  maxBytes?: number;
}) {
  const normalizedArtifacts: AuthoringArtifactOutput[] = [];
  const pinFileImpl = input.pinFileImpl ?? pinFile;
  const unpinCidImpl = input.unpinCidImpl ?? unpinCid;
  const pinnedUris: string[] = [];

  try {
    for (const artifact of input.artifacts) {
      const fetched = await fetchExternalArtifact({
        artifact,
        fetchImpl: input.fetchImpl,
        fetchTimeoutMs: input.fetchTimeoutMs,
        maxBytes: input.maxBytes,
      });

      let tempDir: string | null = null;
      let tempFilePath: string | null = null;
      try {
        tempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), "agora-authoring-artifact-"),
        );
        tempFilePath = path.join(
          tempDir,
          `${randomUUID()}-${fetched.fileName}`,
        );
        await fs.writeFile(tempFilePath, Buffer.from(fetched.bytes));
        const pinnedUri = await pinFileImpl(tempFilePath, fetched.fileName);
        pinnedUris.push(pinnedUri);
        normalizedArtifacts.push({
          id: buildExternalArtifactId(artifact.source_url),
          uri: pinnedUri,
          file_name: fetched.fileName,
          mime_type: fetched.mimeType,
          size_bytes: fetched.bytes.byteLength,
          detected_columns: detectAuthoringArtifactColumns({
            bytes: fetched.bytes,
            fileName: fetched.fileName,
            mimeType: fetched.mimeType,
          }),
        });
      } catch (error) {
        throw artifactFetchError({
          code: "AUTHORING_SOURCE_ARTIFACT_PIN_FAILED",
          status: 502,
          retriable: true,
          message:
            "Pinning the external artifact failed. Next step: retry, then inspect Agora IPFS credentials if the error persists.",
          details: {
            source_url: artifact.source_url,
          },
          cause: error,
        });
      } finally {
        if (tempFilePath) {
          await fs.rm(tempFilePath, { force: true });
        }
        if (tempDir) {
          await fs.rm(tempDir, { recursive: true, force: true });
        }
      }
    }
  } catch (error) {
    await rollbackPinnedArtifacts(pinnedUris, unpinCidImpl);
    throw error;
  }

  return normalizedArtifacts;
}
