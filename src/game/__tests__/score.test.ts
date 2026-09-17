import { describe, expect, it } from "vitest";
import { CLEAN_AWARD, cleanPassAward, computeScore } from "../score.ts";

describe("score", () => {
  it("is floor(distance) + cleanAward + comboPeak×25", () => {
    expect(computeScore(0, 0, 0)).toBe(0);
    expect(computeScore(10.9, 0, 0)).toBe(10);
    expect(computeScore(100, 150, 2)).toBe(100 + 150 + 50);
    expect(computeScore(512.2, 50, 4)).toBe(512 + 50 + 100);
  });

  it("multiplies the next Clean Pass award by (1 + 0.5 × Tension stacks)", () => {
    expect(cleanPassAward(0)).toBe(CLEAN_AWARD);
    expect(cleanPassAward(1)).toBe(75);
    expect(cleanPassAward(2)).toBe(100);
    expect(cleanPassAward(3)).toBe(125);
  });
});
