/**
 * IDENTITY-EDGE-RAIL-v1 — visual ride band, not a collider.
 *
 * Skim/nick bands already exist on the inner playable edge. This module
 * only reports whether the thread is in that band so draw can bloom the
 * rail. Collision / NEAR_MISS_BAND are unchanged (band invitation, not a
 * tightrope).
 */
import { CONTROL_SKIM_HEAT } from "../variant.ts";
import { classifyGapHit, hitObstacle, type Hit } from "./collision.ts";
import { THREAD_RADIUS } from "./constants.ts";
import { moverGap, sampleWalls } from "./course.ts";
import { scoreTickEdgeOn, skimJuice, type World } from "./simulate.ts";

export type RailContact = {
  side: "left" | "right" | null;
  riding: boolean;
  lipId: number;
};

export function isRailRideHit(hit: Hit): boolean {
  return hit === "nearMiss" || hit === "nick";
}

export function closerRailSide(
  x: number,
  left: number,
  right: number,
  radius = THREAD_RADIUS,
): "left" | "right" {
  const innerL = left + radius;
  const innerR = right - radius;
  return x - innerL <= innerR - x ? "left" : "right";
}

/** Live contact on corridor walls and any overlapping lip/mover. */
export function railContact(world: World): RailContact {
  if (!world.alive) return { side: null, riding: false, lipId: 0 };
  let side: "left" | "right" | null = null;
  let riding = false;
  let lipId = 0;

  const walls = sampleWalls(world.course.keyframes, world.distance);
  const wallHit = classifyGapHit(world.x, walls.left, walls.right);
  if (isRailRideHit(wallHit)) {
    riding = true;
    side = closerRailSide(world.x, walls.left, walls.right);
  }

  for (const obs of world.obstacles) {
    const gap = obs.kind === "mover" ? moverGap(obs, world.time) : { left: obs.left, right: obs.right };
    const hit = hitObstacle(world.x, world.distance, obs, gap);
    if (!isRailRideHit(hit)) continue;
    riding = true;
    lipId = obs.id;
    side = closerRailSide(world.x, gap.left, gap.right);
  }

  return { side, riding, lipId };
}

/**
 * Rail heat. 0 = idle silhouette only.
 * Live skim/nick band blooms; score-tick juice attaches a louder bloom.
 * Brake in the center does not light the rail.
 */
export function railBloomHeat(world: World): number {
  if (world.reducedMotion) return 0;
  const contact = railContact(world);
  let heat = 0;
  if (contact.riding) {
    heat = Math.max(heat, skimJuice(world) || CONTROL_SKIM_HEAT);
  }
  if (world.edgeSkimPulse || world.brakeSkimPulse) {
    heat = Math.max(heat, skimJuice(world));
  }
  if (scoreTickEdgeOn(world)) heat = 1;
  return Math.min(1, heat);
}

export function railBloomOn(world: World): boolean {
  return railBloomHeat(world) > 0;
}

/** Stronger bloom while an awarding skim tick is on. */
export function railScoreBloomOn(world: World): boolean {
  return !world.reducedMotion && scoreTickEdgeOn(world);
}
