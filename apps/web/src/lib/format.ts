export function formatUsdc(value: number | string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatWadToScore(wad: string | null) {
  if (!wad) return "-";
  try {
    const raw = BigInt(wad);
    const whole = raw / 10n ** 18n;
    const fraction = raw % 10n ** 18n;
    if (fraction === 0n) return whole.toString();
    const fractionStr = fraction.toString().padStart(18, "0").slice(0, 6);
    return `${whole.toString()}.${fractionStr}`
      .replace(/0+$/, "")
      .replace(/\.$/, "");
  } catch {
    return wad;
  }
}

export function shortAddress(address: string) {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function deadlineCountdown(deadline: string) {
  const ms = new Date(deadline).getTime() - Date.now();
  if (Number.isNaN(ms)) return "Unknown";
  if (ms <= 0) return "Closed";
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return days > 0 ? `${days}d ${rem}h left` : `${rem}h left`;
}
