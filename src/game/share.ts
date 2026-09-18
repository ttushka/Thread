export function formatRunTime(timeMs: number): string {
  const totalSec = Math.max(0, Math.floor(timeMs / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function seedTag(seed: number): string {
  return (seed >>> 0).toString(16).padStart(8, "0");
}

export function dailyDeepLink(dateKey: string, baseUrl?: string): string {
  const hook = `?daily=${dateKey}`;
  if (!baseUrl) return hook;
  try {
    const u = new URL(baseUrl);
    u.search = "";
    u.hash = "";
    u.searchParams.set("daily", dateKey);
    return u.toString();
  } catch {
    const root = baseUrl.replace(/\/$/, "");
    return `${root}/${hook}`;
  }
}

/**
 * Soft Daily invite line (no “beat my…” pressure).
 * Cleared: `Thread Daily YYYY-MM-DD — cleared M:SS · score N · seed <8hex> · play: <url>`
 * Snagged: `Thread Daily YYYY-MM-DD — score N · seed <8hex> · play: <url>`
 */
export function formatDailyShare(opts: {
  dateKey: string;
  score: number;
  timeMs: number;
  seed: number;
  url?: string;
  cleared?: boolean;
}): string {
  const score = Math.floor(opts.score).toLocaleString("en-US");
  const seed = seedTag(opts.seed);
  const url = opts.url && opts.url.length > 0 ? opts.url : "?daily=" + opts.dateKey;
  if (opts.cleared) {
    const time = formatRunTime(opts.timeMs);
    return `Thread Daily ${opts.dateKey} — cleared ${time} · score ${score} · seed ${seed} · play: ${url}`;
  }
  return `Thread Daily ${opts.dateKey} — score ${score} · seed ${seed} · play: ${url}`;
}

export function parseDeepLink(search: string): {
  mode?: "daily" | "endless";
  dateKey?: string;
} {
  const q = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(q);
  const daily = params.get("daily");
  const mode = params.get("mode");
  if (daily && /^\d{4}-\d{2}-\d{2}$/.test(daily)) {
    return { mode: "daily", dateKey: daily };
  }
  if (mode === "daily") return { mode: "daily" };
  if (mode === "endless") return { mode: "endless" };
  return {};
}
