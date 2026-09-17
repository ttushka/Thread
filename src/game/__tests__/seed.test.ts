import { describe, expect, it } from "vitest";
import { dailySeed, dailySeedInput, fnv1a32, SEED_VERSION, utcDateKey } from "../seed.ts";
import dailySeedGolden from "../__fixtures__/daily-seed.json";

describe("utcDateKey", () => {
  it("formats known UTC instants as YYYY-MM-DD", () => {
    expect(utcDateKey(new Date("2026-09-17T00:00:00.000Z"))).toBe("2026-09-17");
    expect(utcDateKey(new Date("2026-09-17T23:59:59.999Z"))).toBe("2026-09-17");
    expect(utcDateKey(new Date("2026-09-18T00:00:00.000Z"))).toBe("2026-09-18");
  });

  it("uses UTC near local-looking midnight fixtures", () => {
    // 2026-09-17 19:30 in US/Eastern is still 2026-09-17 UTC? 
    // 2026-09-17T04:00:00Z is 00:00 EDT — key must stay UTC date.
    expect(utcDateKey(new Date("2026-09-17T04:00:00.000Z"))).toBe("2026-09-17");
    expect(utcDateKey(new Date("2026-09-16T23:59:59.000Z"))).toBe("2026-09-16");
    expect(utcDateKey(new Date("2026-09-17T00:00:00.001Z"))).toBe("2026-09-17");
  });
});

describe("dailySeed", () => {
  it("hashes thread-daily- + date + SEED_VERSION with FNV-1a", () => {
    expect(SEED_VERSION).toBe(2);
    expect(dailySeedInput("2026-09-17")).toBe("thread-daily-2026-09-17:2");
    expect(dailySeed("2026-09-17")).toBe(fnv1a32("thread-daily-2026-09-17:2"));
  });

  it("matches committed golden uint32 for 2026-09-17", () => {
    expect(dailySeed("2026-09-17")).toBe(dailySeedGolden.seed);
    expect(dailySeed("2026-09-17")).toBe(dailySeedGolden["2026-09-17"]);
  });

  it("changes when the UTC day changes", () => {
    expect(dailySeed("2026-09-17")).not.toBe(dailySeed("2026-09-18"));
  });

  it("is stable across repeated calls", () => {
    expect(dailySeed("2026-09-17")).toBe(dailySeed("2026-09-17"));
  });
});
