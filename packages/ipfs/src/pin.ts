import fs from "node:fs/promises";
import path from "node:path";
import { loadIpfsConfig } from "@agora/common";

const PINATA_UPLOAD_URL = "https://uploads.pinata.cloud/v3/files";
const PINATA_PUBLIC_FILES_URL = "https://api.pinata.cloud/v3/files/public";

interface PinataUploadResponse {
  data?: {
    cid?: string;
  };
  error?: unknown;
}

interface PinataPublicFile {
  id?: string;
  cid?: string;
}

interface PinataListFilesResponse {
  data?: {
    files?: PinataPublicFile[];
  };
  error?: unknown;
}

function normalizeIpfsError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(error);
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const directMessage =
      (typeof record.error === "string" && record.error) ||
      (typeof record.message === "string" && record.message) ||
      (typeof record.reason === "string" && record.reason);
    if (directMessage) {
      return new Error(directMessage);
    }
    const nestedError =
      record.error && typeof record.error === "object"
        ? (record.error as Record<string, unknown>)
        : null;
    const nestedMessage =
      nestedError &&
      (((typeof nestedError.reason === "string" && nestedError.reason) ||
        (typeof nestedError.message === "string" && nestedError.message) ||
        (typeof nestedError.details === "string" && nestedError.details)) ??
        null);
    if (nestedMessage) {
      return new Error(nestedMessage);
    }
    try {
      return new Error(JSON.stringify(error));
    } catch {
      return new Error(String(error));
    }
  }
  return new Error(String(error));
}

function getPinataJwt() {
  const config = loadIpfsConfig();
  if (!config.AGORA_PINATA_JWT) {
    throw new Error("AGORA_PINATA_JWT is required to pin to IPFS.");
  }
  return config.AGORA_PINATA_JWT;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${getPinataJwt()}`,
  };
}

async function parseJsonSafely(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function throwPinataHttpError(response: Response): Promise<never> {
  const payload = await parseJsonSafely(response);
  const message =
    (payload && typeof payload.error === "string" && payload.error) ||
    (payload && typeof payload.message === "string" && payload.message) ||
    `Pinata request failed: ${response.status}`;
  throw new Error(message);
}

async function uploadPublicFile(file: File, name: string): Promise<string> {
  const form = new FormData();
  form.set("network", "public");
  form.set("name", name);
  form.set("file", file, name);

  const response = await fetch(PINATA_UPLOAD_URL, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });

  if (!response.ok) {
    await throwPinataHttpError(response);
  }

  const payload = (await response.json()) as PinataUploadResponse;
  const cid = payload.data?.cid;
  if (!cid) {
    throw new Error("Pinata upload response did not include a CID.");
  }
  return `ipfs://${cid}`;
}

async function listPublicFilesByCid(cid: string): Promise<PinataPublicFile[]> {
  const url = new URL(PINATA_PUBLIC_FILES_URL);
  url.searchParams.set("cid", cid);
  url.searchParams.set("limit", "100");

  const response = await fetch(url, {
    headers: authHeaders(),
  });

  if (!response.ok) {
    await throwPinataHttpError(response);
  }

  const payload = (await response.json()) as PinataListFilesResponse;
  return payload.data?.files ?? [];
}

async function deletePublicFileById(id: string): Promise<void> {
  const response = await fetch(`${PINATA_PUBLIC_FILES_URL}/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });

  if (!response.ok) {
    await throwPinataHttpError(response);
  }
}

export async function pinJSON<T extends Record<string, unknown>>(
  name: string,
  payload: T,
): Promise<string> {
  try {
    const json = JSON.stringify(payload, null, 2);
    const file = new File([json], `${name}.json`, {
      type: "application/json",
    });
    return await uploadPublicFile(file, `${name}.json`);
  } catch (error) {
    throw normalizeIpfsError(error);
  }
}

export async function pinFile(
  filePath: string,
  name?: string,
): Promise<string> {
  try {
    const safeName = name ?? path.basename(filePath);
    const file = new File([await fs.readFile(filePath)], safeName);
    return await uploadPublicFile(file, safeName);
  } catch (error) {
    throw normalizeIpfsError(error);
  }
}

export async function unpinCid(cid: string): Promise<void> {
  try {
    const hash = cid.replace("ipfs://", "");
    const files = await listPublicFilesByCid(hash);
    await Promise.all(
      files
        .map((file) => file.id)
        .filter((id): id is string => Boolean(id))
        .map((id) => deletePublicFileById(id)),
    );
  } catch (error) {
    throw normalizeIpfsError(error);
  }
}
