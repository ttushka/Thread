import { LANE_COUNT, LANE_W, LANE_X } from "../variant.ts";
import { THREAD_RADIUS } from "./constants.ts";

export function clampLane(index: number): number {
  return Math.max(0, Math.min(LANE_COUNT - 1, index | 0));
}

export function laneIndexFromX(x: number): number {
  if (x < LANE_W) return 0;
  if (x < LANE_W * 2) return 1;
  return 2;
}

export function laneCenter(index: number): number {
  return LANE_X[clampLane(index)]!;
}

/** Contiguous gap covering every unblocked lane. Always ≥1 safe lane. */
export function gapFromBlockedLanes(blocked: number[]): {
  left: number;
  right: number;
  center: number;
  gap: number;
} {
  const occ = [false, false, false];
  for (const b of blocked) {
    if (b >= 0 && b <= 2) occ[b] = true;
  }
  if (occ[0] && occ[1] && occ[2]) occ[1] = false;
  let first = 0;
  while (first < 3 && occ[first]) first += 1;
  let last = 2;
  while (last >= 0 && occ[last]) last -= 1;
  if (first > last) {
    first = 1;
    last = 1;
  }
  const left = first * LANE_W;
  const right = (last + 1) * LANE_W;
  return { left, right, center: (left + right) / 2, gap: right - left };
}

/** Side-biased 1- or 2-lane blocks so the gap stays a single opening. */
export function blockPattern(side: -1 | 1, twoLane: boolean): number[] {
  if (twoLane) return side < 0 ? [0, 1] : [1, 2];
  return side < 0 ? [0] : [2];
}

export function laneIsBlockedByGap(
  lane: number,
  gap: { left: number; right: number },
  radius = THREAD_RADIUS,
): boolean {
  const x = laneCenter(lane);
  return x < gap.left + radius || x > gap.right - radius;
}

/** True when a neighboring tile's shared edge is a blocked slab. */
export function neighborLaneBlocked(
  lane: number,
  gap: { left: number; right: number },
  radius = THREAD_RADIUS,
): boolean {
  const i = clampLane(lane);
  if (i > 0 && laneIsBlockedByGap(i - 1, gap, radius)) return true;
  if (i < LANE_COUNT - 1 && laneIsBlockedByGap(i + 1, gap, radius)) return true;
  return false;
}
