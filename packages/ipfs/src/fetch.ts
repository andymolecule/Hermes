import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "@hermes/common";

function resolveGateway(cidOrUrl: string): string {
  if (cidOrUrl.startsWith("ipfs://")) {
    const config = loadConfig();
    const gateway =
      config.HERMES_IPFS_GATEWAY ?? "https://gateway.pinata.cloud/ipfs/";
    return `${gateway}${cidOrUrl.replace("ipfs://", "")}`;
  }
  return cidOrUrl;
}

export async function getJSON<T = unknown>(cidOrUrl: string): Promise<T> {
  const url = resolveGateway(cidOrUrl);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch JSON from ${url}: ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function getText(cidOrUrl: string): Promise<string> {
  const url = resolveGateway(cidOrUrl);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch text from ${url}: ${response.status}`);
  }
  return await response.text();
}

export async function getFile(cidOrUrl: string): Promise<ArrayBuffer> {
  const url = resolveGateway(cidOrUrl);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch file from ${url}: ${response.status}`);
  }
  return await response.arrayBuffer();
}

export async function downloadToPath(
  cidOrUrl: string,
  outPath: string,
): Promise<string> {
  const data = await getFile(cidOrUrl);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, Buffer.from(data));
  return outPath;
}
