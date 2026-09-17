import type { ObstacleSpec } from "../../types.ts";
import { NICK_BAND, THREAD_RADIUS } from "./constants.ts";

export type Hit = "none" | "nick" | "death";

export function classifyGapHit(x: number, left: number, right: number, radius = THREAD_RADIUS): Hit {
  const innerL = left + radius;
  const innerR = right - radius;
  if (x < innerL || x > innerR) return "death";
  if (x < innerL + NICK_BAND || x > innerR - NICK_BAND) return "nick";
  return "none";
}

export function hitObstacle(
  x: number,
  distance: number,
  spec: ObstacleSpec,
  gap: { left: number; right: number },
): Hit {
  const half = spec.thickness / 2;
  if (distance < spec.y - half || distance > spec.y + half) return "none";
  return classifyGapHit(x, gap.left, gap.right);
}
