const CID_V0_REGEX = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const CID_V1_BASE32_REGEX = /^b[a-z2-7]{20,}$/;
const CID_V1_BASE58BTC_REGEX = /^z[1-9A-HJ-NP-Za-km-z]{20,}$/;

const KNOWN_PLACEHOLDER_CIDS = new Set([
  "qmtestdeploy",
]);

export function extractCid(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("ipfs://")) {
    return trimmed.slice("ipfs://".length).replace(/^ipfs\//, "");
  }
  return trimmed;
}

export function isValidCid(value: string): boolean {
  const cid = extractCid(value);
  return (
    CID_V0_REGEX.test(cid)
    || CID_V1_BASE32_REGEX.test(cid)
    || CID_V1_BASE58BTC_REGEX.test(cid)
  );
}

export function isPlaceholderCid(value: string): boolean {
  const cid = extractCid(value).toLowerCase();
  return KNOWN_PLACEHOLDER_CIDS.has(cid);
}

export function isValidPinnedSpecCid(value: string): boolean {
  const raw = value.trim();
  if (!raw.startsWith("ipfs://")) return false;
  if (!isValidCid(raw)) return false;
  if (isPlaceholderCid(raw)) return false;
  return true;
}
