import { describe, expect, it } from "vitest";
import { computeScore } from "../score.ts";

describe("score", () => {
  it("is floor(distance) + cleanPasses×50 + comboPeak×25", () => {
    expect(computeScore(0, 0, 0)).toBe(0);
    expect(computeScore(10.9, 0, 0)).toBe(10);
    expect(computeScore(100, 3, 2)).toBe(100 + 150 + 50);
    expect(computeScore(512.2, 1, 4)).toBe(512 + 50 + 100);
  });
});
