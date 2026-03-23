import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AgoraError,
  authoringSessionArtifactSchema,
  authoringSessionFileInputSchema,
  type AuthoringArtifactOutput,
} from "@agora/common";
import { pinFile } from "@agora/ipfs";
import { z } from "zod";
import {
  detectAuthoringArtifactColumns,
  normalizeExternalArtifactsForDraft,
} from "./authoring-artifacts.js";

const ARTIFACT_REF_PREFIX = "agora_artifact_v1_";

type AuthoringSessionArtifactOutput = z.output<
  typeof authoringSessionArtifactSchema
>;
type AuthoringSessionFileInputInput = z.input<
  typeof authoringSessionFileInputSchema
>;

export interface StoredAuthoringSessionArtifact extends AuthoringArtifactOutput {
  source_url?: string | null;
  role?: string | null;
}

function encodeArtifactPayload(input: {
  uri: string;
  file_name: string;
  mime_type?: string | null;
  size_bytes?: number;
  source_url?: string | null;
  detected_columns?: string[];
}) {
  return Buffer.from(JSON.stringify(input), "utf8").toString("base64url");
}

function decodeArtifactPayload(encoded: string) {
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
      uri: string;
      file_name: string;
      mime_type?: string | null;
      size_bytes?: number;
      source_url?: string | null;
      detected_columns?: string[];
    };
  } catch {
    throw new AgoraError(
      "Artifact reference is invalid. Next step: upload the file again and retry with the returned artifact_id.",
      {
        code: "invalid_request",
        status: 400,
      },
    );
  }
}

export function encodeAuthoringSessionArtifactId(
  artifact: Pick<
    StoredAuthoringSessionArtifact,
    | "uri"
    | "file_name"
    | "mime_type"
    | "size_bytes"
    | "source_url"
    | "detected_columns"
  >,
) {
  return `${ARTIFACT_REF_PREFIX}${encodeArtifactPayload({
    uri: artifact.uri,
    file_name: artifact.file_name ?? "artifact",
    mime_type: artifact.mime_type ?? null,
    size_bytes: artifact.size_bytes,
    source_url: artifact.source_url ?? null,
    detected_columns: artifact.detected_columns,
  })}`;
}

export function decodeAuthoringSessionArtifactId(artifactId: string) {
  if (!artifactId.startsWith(ARTIFACT_REF_PREFIX)) {
    throw new AgoraError(
      "Artifact reference is invalid. Next step: upload the file again and retry with the returned artifact_id.",
      {
        code: "invalid_request",
        status: 400,
      },
    );
  }

  const payload = decodeArtifactPayload(artifactId.slice(ARTIFACT_REF_PREFIX.length));
  return {
    id: artifactId,
    uri: payload.uri,
    file_name: payload.file_name,
    mime_type: payload.mime_type ?? undefined,
    size_bytes: payload.size_bytes,
    source_url: payload.source_url ?? null,
    detected_columns: payload.detected_columns,
  } satisfies StoredAuthoringSessionArtifact;
}

export function toStoredAuthoringSessionArtifact(
  artifact: StoredAuthoringSessionArtifact,
): StoredAuthoringSessionArtifact {
  return {
    ...artifact,
    id: artifact.id?.trim() || encodeAuthoringSessionArtifactId(artifact),
    file_name: artifact.file_name ?? "artifact",
    role: artifact.role ?? null,
    source_url: artifact.source_url ?? null,
    detected_columns: artifact.detected_columns,
  };
}

export function toAuthoringSessionArtifactPayload(
  artifact: StoredAuthoringSessionArtifact,
): AuthoringSessionArtifactOutput {
  const normalized = toStoredAuthoringSessionArtifact(artifact);
  return {
    artifact_id: normalized.id ?? encodeAuthoringSessionArtifactId(normalized),
    uri: normalized.uri,
    file_name: normalized.file_name ?? "artifact",
    role: normalized.role ?? null,
    source_url: normalized.source_url ?? null,
  };
}

export function mergeStoredArtifacts(
  current: StoredAuthoringSessionArtifact[],
  incoming: StoredAuthoringSessionArtifact[],
) {
  const byId = new Map<string, StoredAuthoringSessionArtifact>();

  for (const artifact of current) {
    const normalized = toStoredAuthoringSessionArtifact(artifact);
    if (normalized.id) {
      byId.set(normalized.id, normalized);
    }
  }

  for (const artifact of incoming) {
    const normalized = toStoredAuthoringSessionArtifact(artifact);
    if (normalized.id) {
      byId.set(normalized.id, normalized);
    }
  }

  return Array.from(byId.values());
}

export async function normalizeAuthoringSessionFileInputs(input: {
  files: AuthoringSessionFileInputInput[];
}) {
  const resolved: StoredAuthoringSessionArtifact[] = [];

  for (const file of input.files) {
    if (file.type === "artifact") {
      resolved.push(decodeAuthoringSessionArtifactId(file.artifact_id));
      continue;
    }

    const [artifact] = await normalizeExternalArtifactsForDraft({
      artifacts: [{ source_url: file.url }],
    });
    if (!artifact) {
      continue;
    }

    resolved.push(
      toStoredAuthoringSessionArtifact({
        ...artifact,
        source_url: file.url,
      }),
    );
  }

  return resolved;
}

export async function createDirectAuthoringSessionArtifact(input: {
  bytes: Uint8Array;
  fileName: string;
  pinFileImpl?: typeof pinFile;
}) {
  const safeFileName = path.basename(input.fileName).trim() || "artifact";
  const pinFileImpl = input.pinFileImpl ?? pinFile;

  let tempDir: string | null = null;
  let tempFilePath: string | null = null;

  try {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agora-authoring-upload-"));
    tempFilePath = path.join(tempDir, `${randomUUID()}-${safeFileName}`);
    await fs.writeFile(tempFilePath, Buffer.from(input.bytes));
    const uri = await pinFileImpl(tempFilePath, safeFileName);
    return toStoredAuthoringSessionArtifact({
      id: undefined,
      uri,
      file_name: safeFileName,
      size_bytes: input.bytes.byteLength,
      source_url: null,
      role: null,
      detected_columns: detectAuthoringArtifactColumns({
        bytes: input.bytes,
        fileName: safeFileName,
      }),
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
