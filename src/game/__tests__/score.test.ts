import { describe, expect, it } from "vitest";
import {
  CLEAN_AWARD,
  SKIM_AWARD,
  SKIM_MULT_PER_COMBO,
  THROUGH_AWARD,
  cleanPassAward,
  computeScore,
  skimAward,
  skimMultiplier,
} from "../score.ts";

describe("score", () => {
  it("is 0 when there are no skim events, even with distance", () => {
    expect(computeScore(0, 0, 0, 0)).toBe(0);
    expect(computeScore(10.9, 0, 0, 0)).toBe(0);
    expect(computeScore(512.2, 0, 4, 0)).toBe(0);
    expect(THROUGH_AWARD).toBe(0);
  });

  it("is floor(distance × (1 + 0.25 × comboPeak)) + skimCash after a skim", () => {
    expect(skimMultiplier(1, 0)).toBe(1);
    expect(skimMultiplier(1, 2)).toBe(1 + SKIM_MULT_PER_COMBO * 2);
    expect(computeScore(100, 150, 2, 1)).toBe(Math.floor(100 * 1.5) + 150);
    expect(computeScore(512.2, 50, 4, 3)).toBe(Math.floor(512.2 * 2) + 50);
    expect(computeScore(10.9, 0, 0, 1)).toBe(10);
  });

  it("does not pay Perfect style — Beat Perfect is juice only", () => {
    expect(computeScore(100, 50, 2, 1)).toBe(Math.floor(100 * 1.5) + 50);
    expect(computeScore(100, 50, 2, 3)).toBe(Math.floor(100 * 1.5) + 50);
  });

  it("multiplies the next skim-gated cash by (1 + 0.5 × Tension stacks)", () => {
    expect(SKIM_AWARD).toBe(CLEAN_AWARD);
    expect(skimAward(0)).toBe(SKIM_AWARD);
    expect(skimAward(1)).toBe(75);
    expect(skimAward(2)).toBe(100);
    expect(skimAward(3)).toBe(125);
    expect(cleanPassAward(2)).toBe(skimAward(2));
  });
});
