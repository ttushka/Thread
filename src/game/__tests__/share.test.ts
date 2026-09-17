import { describe, expect, it } from "vitest";
import { dailyDeepLink, formatDailyShare, formatRunTime, parseDeepLink, seedTag } from "../share.ts";

describe("share line", () => {
  it("emits the growth-ready Daily line", () => {
    const line = formatDailyShare({
      dateKey: "2026-09-17",
      score: 12340,
      timeMs: 42_000,
      seed: 0xabc12,
      url: "https://example.com/thread/?daily=2026-09-17",
    });
    expect(line).toBe(
      "Thread Daily 2026-09-17 — 12,340/0:42 · seed 000abc12 · beat my time: https://example.com/thread/?daily=2026-09-17",
    );
  });

  it("falls back to a query hook when the public URL is unknown", () => {
    const line = formatDailyShare({
      dateKey: "2026-09-17",
      score: 10,
      timeMs: 1500,
      seed: 1,
    });
    expect(line).toContain("Thread Daily 2026-09-17 — 10/0:01 · seed 00000001 · beat my time: ?daily=2026-09-17");
  });

  it("formats time and seed tags", () => {
    expect(formatRunTime(0)).toBe("0:00");
    expect(formatRunTime(61_000)).toBe("1:01");
    expect(seedTag(255)).toBe("000000ff");
  });

  it("builds a same-day deep link", () => {
    expect(dailyDeepLink("2026-09-17")).toBe("?daily=2026-09-17");
    expect(dailyDeepLink("2026-09-17", "https://play.example/thread")).toBe(
      "https://play.example/thread?daily=2026-09-17",
    );
    expect(dailyDeepLink("2026-09-17", "https://ttushka.github.io/Thread")).toBe(
      "https://ttushka.github.io/Thread?daily=2026-09-17",
    );
    expect(dailyDeepLink("2026-09-17", "https://ttushka.github.io/Thread/")).toBe(
      "https://ttushka.github.io/Thread/?daily=2026-09-17",
    );
  });

  it("parses daily deep links", () => {
    expect(parseDeepLink("?daily=2026-09-17")).toEqual({ mode: "daily", dateKey: "2026-09-17" });
    expect(parseDeepLink("mode=endless")).toEqual({ mode: "endless" });
  });
});
