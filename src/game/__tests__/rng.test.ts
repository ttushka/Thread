import { describe, expect, it } from "vitest";
import { mulberry32, Rng } from "../rng.ts";
import prngGolden from "../__fixtures__/prng.json";

describe("mulberry32", () => {
  it("matches the golden first-N sequence for seed S", () => {
    const next = mulberry32(prngGolden.seed);
    const got = Array.from({ length: prngGolden.seq.length }, () => next());
    expect(got).toEqual(prngGolden.seq);
  });

  it("is deterministic from the same seed", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 32; i++) expect(a()).toBe(b());
  });
});

describe("Rng", () => {
  it("stays in [0, 1) and int() stays inclusive", () => {
    const rng = new Rng(99);
    for (let i = 0; i < 200; i++) {
      const n = rng.next();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
    const rng2 = new Rng(7);
    for (let i = 0; i < 80; i++) {
      const n = rng2.int(2, 5);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
    }
    const rng3 = new Rng(11);
    expect([-1, 1]).toContain(rng3.pick([-1, 1] as const));
    const picks = Array.from({ length: 40 }, () => new Rng(11).pick(["a", "b", "c"]));
    expect(picks.every((p) => p === picks[0])).toBe(true);
  });
});
