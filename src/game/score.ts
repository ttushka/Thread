/** Base Clean Pass award. Tension multiplies this once, then clears. */
export const CLEAN_AWARD = 50;

/**
 * Tension formula: next Clean Pass award = CLEAN_AWARD × (1 + 0.5 × stacks), then stacks clear.
 * Stacks are 0–3, so the multiplier is 1 / 1.5 / 2 / 2.5.
 */
export function cleanPassAward(tensionStacks: number): number {
  return CLEAN_AWARD * (1 + 0.5 * Math.max(0, tensionStacks));
}

/** score = floor(distance) + cleanAward + (comboPeak × 25) */
export function computeScore(
  distance: number,
  cleanAward: number,
  comboPeak: number,
): number {
  return Math.floor(distance) + cleanAward + comboPeak * 25;
}
