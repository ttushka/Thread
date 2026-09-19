/**
 * BIG-FEEL-REDESIGN-v1 PR1 — skim is the only scoring verb.
 *
 * Cash rule (picked): Tension cashes on the next skim-gated lip
 * (a lip the thread passed inside the existing near-miss band).
 * Center-clean lips never cash. Wall skims stack Tension and unlock
 * the distance multiplier; they do not pay style until a skim-gated lip.
 *
 * score = floor(distance × skimMultiplier) + skimCash
 * skimMultiplier is 0 until a skim-gated lip (comboPeak ≥ 1), then 1 + 0.25 × comboPeak.
 * Wall skims unlock Tension / skimEvents but do not bank distance alone.
 * Combo climbs only on skim-gated lips. Beat Perfect is juice / heat only.
 */

/** Skim-gated lip cash. Tension multiplies this once, then clears. */
export const SKIM_AWARD = 50;
/** Same value as SKIM_AWARD — cash is skim-gated; center-clean pays 0. */
export const CLEAN_AWARD = SKIM_AWARD;

/** Distance multiplier step per combo peak after the first skim. */
export const SKIM_MULT_PER_COMBO = 0.25;

/** Center-clean lip payout. Token 0 — through feedback is HUD-only. */
export const THROUGH_AWARD = 0;

/**
 * Tension formula: next skim-gated lip award = SKIM_AWARD × (1 + 0.5 × stacks), then stacks clear.
 * Stacks are 0–3, so the multiplier is 1 / 1.5 / 2 / 2.5.
 */
export function skimAward(tensionStacks: number): number {
  return SKIM_AWARD * (1 + 0.5 * Math.max(0, tensionStacks));
}

/** Alias for the Tension cash formula (no longer paid on center-clean). */
export function cleanPassAward(tensionStacks: number): number {
  return skimAward(tensionStacks);
}

/** 0 until a skim-gated lip so a graze or center-clean run scores like failure. */
export function skimMultiplier(skimEvents: number, comboPeak: number): number {
  if (skimEvents <= 0 || comboPeak <= 0) return 0;
  return 1 + SKIM_MULT_PER_COMBO * comboPeak;
}

/**
 * score = floor(distance × skimMultiplier) + skimCash
 * Distance pays only after a skim-gated lip. Perfect style is not in this formula.
 */
export function computeScore(
  distance: number,
  skimCash: number,
  comboPeak: number,
  skimEvents: number,
): number {
  const cash = Math.max(0, Math.floor(skimCash));
  const travelled = Math.max(0, distance);
  return Math.floor(travelled * skimMultiplier(skimEvents, comboPeak)) + cash;
}
