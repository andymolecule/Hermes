export function normalizeSessionAddress(value: string | null | undefined) {
  return typeof value === "string" && value.length > 0
    ? value.toLowerCase()
    : null;
}

export function getMatchingOptionalSessionAddress(
  sessionAddress: string | null | undefined,
  expectedAddress: string,
) {
  const normalizedSession = normalizeSessionAddress(sessionAddress);
  const normalizedExpected = expectedAddress.toLowerCase();
  return normalizedSession === normalizedExpected ? normalizedSession : null;
}
