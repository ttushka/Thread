/**
 * IDENTITY-EDGE-RAIL-v1 — visual ride band, not a collider.
 *
 * Skim/nick bands already exist on the inner playable edge. This module
 * reports proximity so draw can bloom the rail. Collision / NEAR_MISS_BAND
 * are unchanged — bloom is a wider band invitation, not a tightrope.
 */
import { type Hit } from "./collision.ts";
import { NEAR_MISS_BAND, NICK_BAND, THREAD_RADIUS } from "./constants.ts";
import { moverGap, sampleWalls } from "./course.ts";
import { scoreTickEdgeOn, type World } from "./simulate.ts";

/** Extra visual invite beyond the skim collider so the rail reads as a band, not a grind. */
export const RAIL_INVITE_PX = 22;
export const RAIL_VISUAL_BAND = NICK_BAND + NEAR_MISS_BAND + RAIL_INVITE_PX;

export type RailContact = {
  side: "left" | "right" | null;
  riding: boolean;
  lipId: number;
  /** 0 idle … 1 in the skim/nick band. Soft falloff across the invite. */
  proximity: number;
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

/** Distance from the thread to the inner playable edge (≥0 inside the gap). */
export function railEdgeDist(x: number, left: number, right: number, radius = THREAD_RADIUS): number {
  const innerL = left + radius;
  const innerR = right - radius;
  return Math.min(x - innerL, innerR - x);
}

/** Visual heat from gap distance. 1 inside skim/nick; falls off across the invite. */
export function railProximity(dist: number): number {
  if (!Number.isFinite(dist) || dist < 0) return 0;
  const skim = NICK_BAND + NEAR_MISS_BAND;
  if (dist < skim) return 1;
  if (dist >= RAIL_VISUAL_BAND) return 0;
  return 1 - (dist - skim) / RAIL_INVITE_PX;
}

function considerGap(
  x: number,
  left: number,
  right: number,
  current: RailContact,
  lipId = 0,
): RailContact {
  const dist = railEdgeDist(x, left, right);
  const proximity = railProximity(dist);
  if (proximity <= current.proximity) return current;
  return {
    side: closerRailSide(x, left, right),
    riding: proximity > 0,
    lipId,
    proximity,
  };
}

/** Live contact on corridor walls and any overlapping lip/mover. */
export function railContact(world: World): RailContact {
  const idle: RailContact = { side: null, riding: false, lipId: 0, proximity: 0 };
  if (!world.alive) return idle;
  let best = idle;

  const walls = sampleWalls(world.course.keyframes, world.distance);
  best = considerGap(world.x, walls.left, walls.right, best);

  for (const obs of world.obstacles) {
    const half = obs.thickness / 2;
    if (world.distance < obs.y - half || world.distance > obs.y + half) continue;
    const gap = obs.kind === "mover" ? moverGap(obs, world.time) : { left: obs.left, right: obs.right };
    best = considerGap(world.x, gap.left, gap.right, best, obs.id);
  }

  return best;
}

/**
 * Rail heat. 0 = idle silhouette only.
 * Live visual band blooms at full; score-tick juice attaches a louder stroke.
 * Brake in the center does not light the rail.
 */
export function railBloomHeat(world: World): number {
  if (world.reducedMotion) return 0;
  const contact = railContact(world);
  let heat = contact.proximity;
  if (world.edgeSkimPulse || world.brakeSkimPulse) heat = Math.max(heat, 1);
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
