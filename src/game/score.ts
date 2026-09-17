/** score = floor(distance) + (cleanPasses × 50) + (comboPeak × 25) */
export function computeScore(
  distance: number,
  cleanPasses: number,
  comboPeak: number,
): number {
  return Math.floor(distance) + cleanPasses * 50 + comboPeak * 25;
}
