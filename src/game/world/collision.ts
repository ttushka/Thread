import type { ObstacleSpec } from "../../types.ts";
import { NEAR_MISS_BAND, NICK_BAND, THREAD_RADIUS } from "./constants.ts";

export type Hit = "none" | "nearMiss" | "nick" | "death";

export function classifyGapHit(x: number, left: number, right: number, radius = THREAD_RADIUS): Hit {
  const innerL = left + radius;
  const innerR = right - radius;
  if (x < innerL || x > innerR) return "death";
  const edgeDist = Math.min(x - innerL, innerR - x);
  if (edgeDist < NICK_BAND) return "nick";
  if (edgeDist < NICK_BAND + NEAR_MISS_BAND) return "nearMiss";
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
