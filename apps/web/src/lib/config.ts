import { DEFAULT_CHAIN_ID } from "@hermes/common";

function normalizeAddress(value: string | undefined) {
  return typeof value === "string" && value.length > 0
    ? value.toLowerCase()
    : undefined;
}

function assertServerEnvAlignment() {
  if (typeof window !== "undefined") return;

  const mismatches: string[] = [];
  const pairs = [
    [
      "factory",
      normalizeAddress(process.env.HERMES_FACTORY_ADDRESS),
      normalizeAddress(process.env.NEXT_PUBLIC_HERMES_FACTORY_ADDRESS),
    ],
    [
      "usdc",
      normalizeAddress(process.env.HERMES_USDC_ADDRESS),
      normalizeAddress(process.env.NEXT_PUBLIC_HERMES_USDC_ADDRESS),
    ],
    [
      "chainId",
      process.env.HERMES_CHAIN_ID,
      process.env.NEXT_PUBLIC_HERMES_CHAIN_ID,
    ],
  ] as const;

  for (const [label, serverValue, publicValue] of pairs) {
    if (serverValue && publicValue && serverValue !== publicValue) {
      mismatches.push(
        `${label}: server=${serverValue} public=${publicValue}`,
      );
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      `Hermes web env mismatch detected. Align HERMES_* and NEXT_PUBLIC_HERMES_* values.\n- ${mismatches.join("\n- ")}`,
    );
  }
}

assertServerEnvAlignment();

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_HERMES_API_URL ?? "http://localhost:3000";

export const FACTORY_ADDRESS = (process.env
  .NEXT_PUBLIC_HERMES_FACTORY_ADDRESS ?? "") as `0x${string}`;

export const USDC_ADDRESS = (process.env.NEXT_PUBLIC_HERMES_USDC_ADDRESS ??
  "") as `0x${string}`;

export const CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_HERMES_CHAIN_ID ?? DEFAULT_CHAIN_ID,
);

export const RPC_URL =
  process.env.NEXT_PUBLIC_HERMES_RPC_URL ?? "https://sepolia.base.org";
