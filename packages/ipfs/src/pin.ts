import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "@hermes/common";
import pinataSDK from "@pinata/sdk";

function createClient() {
  const config = loadConfig();
  if (!config.HERMES_PINATA_JWT) {
    throw new Error("HERMES_PINATA_JWT is required to pin to IPFS.");
  }
  return new pinataSDK({ pinataJWTKey: config.HERMES_PINATA_JWT });
}

let cachedClient: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (!cachedClient) {
    cachedClient = createClient();
  }
  return cachedClient;
}

export async function pinJSON<T extends Record<string, unknown>>(
  name: string,
  payload: T,
): Promise<string> {
  const client = getClient();
  const result = await client.pinJSONToIPFS(payload, {
    pinataMetadata: { name },
  });
  return `ipfs://${result.IpfsHash}`;
}

export async function pinFile(
  filePath: string,
  name?: string,
): Promise<string> {
  const client = getClient();
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const stream = fs.createReadStream(filePath);
  const result = await client.pinFileToIPFS(stream, {
    pinataMetadata: { name: name ?? path.basename(filePath) },
  });
  return `ipfs://${result.IpfsHash}`;
}

export async function pinDirectory(
  dirPath: string,
  name?: string,
): Promise<string> {
  const client = getClient();
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Directory not found: ${dirPath}`);
  }
  const result = await client.pinFromFS(dirPath, {
    pinataMetadata: { name: name ?? path.basename(dirPath) },
  });
  return `ipfs://${result.IpfsHash}`;
}
