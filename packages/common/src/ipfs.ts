const CID_V0_REGEX = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const CID_V1_REGEXES = [
  /^b[a-z2-7]{20,}$/, // base32 lower
  /^B[A-Z2-7]{20,}$/, // base32 upper
  /^k[0-9a-z]{20,}$/, // base36 lower
  /^K[0-9A-Z]{20,}$/, // base36 upper
  /^z[1-9A-HJ-NP-Za-km-z]{20,}$/, // base58btc
  /^Z[1-9A-HJ-NP-Za-km-z]{20,}$/, // base58flickr
  /^f[0-9a-f]{20,}$/, // base16 lower
  /^F[0-9A-F]{20,}$/, // base16 upper
  /^m[A-Za-z0-9+/]{20,}={0,2}$/, // base64
  /^M[A-Za-z0-9+/]{20,}={0,2}$/, // base64pad
  /^u[A-Za-z0-9_-]{20,}$/, // base64url
  /^U[A-Za-z0-9_-]{20,}={0,2}$/, // base64urlpad
];

const KNOWN_PLACEHOLDER_CIDS = new Set(["qmtestdeploy"]);

export function extractCid(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("ipfs://")) {
    return trimmed.slice("ipfs://".length).replace(/^ipfs\//, "");
  }
  return trimmed;
}

export function isValidCid(value: string): boolean {
  const cid = extractCid(value);
  return CID_V0_REGEX.test(cid) || CID_V1_REGEXES.some((re) => re.test(cid));
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
