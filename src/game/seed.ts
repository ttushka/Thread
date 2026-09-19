/**
 * FNV-1a 32-bit over UTF-8 bytes. Pure: same string → same uint32 forever.
 */
export function fnv1a32(input: string): number {
  const bytes = utf8Bytes(input);
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function utf8Bytes(input: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(input);
  }
  const out: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        const cp = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
        out.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f),
        );
        continue;
      }
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return Uint8Array.from(out);
}

/**
 * Bump only when generation rules change. Mid-day bumps break Daily continuity —
 * do it in the same PR as golden fixture updates.
 */
export const SEED_VERSION = 5;

export const DAILY_PREFIX = "thread-daily-";

/** UTC calendar date as YYYY-MM-DD. Local timezone must not affect this. */
export function utcDateKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Canonical hash input for a Daily Challenge day. */
export function dailySeedInput(dateKey: string, seedVersion = SEED_VERSION): string {
  return `${DAILY_PREFIX}${dateKey}:${seedVersion}`;
}

/** FNV-1a 32-bit of `"thread-daily-" + UTC YYYY-MM-DD` + SEED_VERSION. */
export function dailySeed(dateKey: string, seedVersion = SEED_VERSION): number {
  return fnv1a32(dailySeedInput(dateKey, seedVersion));
}

/**
 * Endless run seed. Crypto when available; never used on the Daily path.
 */
export function randomRunSeed(): number {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const n = buf[0] >>> 0;
    return n === 0 ? 1 : n;
  }
  const t = Date.now() >>> 0;
  const p =
    typeof performance !== "undefined" ? (performance.now() * 1000) >>> 0 : 0;
  const mixed = (t ^ (p + 0x9e3779b9)) >>> 0;
  return mixed === 0 ? 1 : mixed;
}
