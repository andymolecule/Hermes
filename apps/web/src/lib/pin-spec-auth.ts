import { keccak256, toBytes } from "viem";

export const PIN_SPEC_AUTH_MAX_AGE_MS = 5 * 60 * 1000;

export function computeSpecHash(spec: unknown): `0x${string}` {
  return keccak256(toBytes(JSON.stringify(spec)));
}

export function buildPinSpecMessage(input: {
  address: `0x${string}`;
  timestamp: number;
  specHash: `0x${string}`;
}) {
  return [
    "Hermes pin-spec authorization",
    `address:${input.address.toLowerCase()}`,
    `timestamp:${input.timestamp}`,
    `specHash:${input.specHash}`,
  ].join("\n");
}
