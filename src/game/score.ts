/** Base Clean Pass award. Tension multiplies this once, then clears. */
export const CLEAN_AWARD = 50;
export const PERFECT_AWARD = 25;

/**
 * Tension formula: next Clean Pass award = CLEAN_AWARD × (1 + 0.5 × stacks), then stacks clear.
 * Stacks are 0–3, so the multiplier is 1 / 1.5 / 2 / 2.5.
 */
export function cleanPassAward(tensionStacks: number): number {
  return CLEAN_AWARD * (1 + 0.5 * Math.max(0, tensionStacks));
}

/**
 * score = floor(distance) + cleanAward + (comboPeak × 25) + (perfects × 25)
 * `perfects` is Beat-only; control passes 0 so the formula is unchanged.
 */
export function computeScore(
  distance: number,
  cleanAward: number,
  comboPeak: number,
  perfects = 0,
): number {
  return Math.floor(distance) + cleanAward + comboPeak * 25 + Math.max(0, Math.floor(perfects)) * PERFECT_AWARD;
}
