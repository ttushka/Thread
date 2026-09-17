import type { CourseSpec, ObstacleSpec, Particle } from "../../types.ts";
import type { Intent } from "../../types.ts";
import { computeScore } from "../score.ts";
import {
  BASE_SPEED,
  DEATH_DISSOLVE_MS,
  DEATH_FLASH_MS,
  DEATH_FREEZE_MS,
  DIST,
  FIELD_W,
  NEAR_MISS_MS,
  NICK_BAND,
  NICK_MS,
  NICK_SLOW,
  POINTER_LERP,
  STEER_SPEED,
  THREAD_RADIUS,
  TRAIL_MAX,
} from "./constants.ts";
import { classifyGapHit, hitObstacle } from "./collision.ts";
import { generateCourse, moverGap, sampleWalls } from "./course.ts";

export type World = {
  course: CourseSpec;
  distance: number;
  prevDistance: number;
  x: number;
  prevX: number;
  alive: boolean;
  cleared: boolean;
  nickTimer: number;
  deathAge: number;
  nearMissTimer: number;
  combo: number;
  comboPeak: number;
  cleanPasses: number;
  time: number;
  trail: { x: number; d: number }[];
  particles: Particle[];
  reducedMotion: boolean;
  obstacles: ObstacleRuntime[];
};

type ObstacleRuntime = ObstacleSpec & {
  passed: boolean;
  nicked: boolean;
};

function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export function createWorld(
  seed: number,
  opts: { daily: boolean; reducedMotion: boolean; endlessHorizon?: number },
): World {
  const course = generateCourse(seed, {
    daily: opts.daily,
    endlessHorizon: opts.endlessHorizon,
  });
  const x = FIELD_W / 2;
  return {
    course,
    distance: 0,
    prevDistance: 0,
    x,
    prevX: x,
    alive: true,
    cleared: false,
    nickTimer: 0,
    deathAge: 0,
    nearMissTimer: 0,
    combo: 0,
    comboPeak: 0,
    cleanPasses: 0,
    time: 0,
    trail: [{ x, d: 0 }],
    particles: [],
    reducedMotion: opts.reducedMotion,
    obstacles: course.obstacles.map((o) => ({ ...o, passed: false, nicked: false })),
  };
}

export function worldScore(world: World): number {
  return computeScore(world.distance, world.cleanPasses, world.comboPeak);
}

export function updateWorld(world: World, intent: Intent, dt: number): void {
  if (!world.alive) {
    world.deathAge += dt;
    fadeParticles(world, dt);
    return;
  }
  if (world.cleared) {
    world.deathAge += dt;
    fadeParticles(world, dt);
    return;
  }

  world.prevX = world.x;
  world.prevDistance = world.distance;

  if (intent.pointerActive) {
    const clamped = Math.max(THREAD_RADIUS, Math.min(FIELD_W - THREAD_RADIUS, intent.pointerX));
    world.x = damp(world.x, clamped, POINTER_LERP, dt);
  } else {
    world.x += intent.steer * STEER_SPEED * dt;
  }
  world.x = Math.max(THREAD_RADIUS, Math.min(FIELD_W - THREAD_RADIUS, world.x));

  const speeding = world.nickTimer > 0 ? NICK_SLOW : 1;
  world.distance += BASE_SPEED * speeding * dt;
  world.time += dt;
  if (world.nickTimer > 0) world.nickTimer = Math.max(0, world.nickTimer - dt);
  if (world.nearMissTimer > 0) world.nearMissTimer = Math.max(0, world.nearMissTimer - dt);

  const walls = sampleWalls(world.course.keyframes, world.distance);
  if (world.distance < DIST.openEnd) {
    const safeL = walls.left + THREAD_RADIUS + NICK_BAND;
    const safeR = walls.right - THREAD_RADIUS - NICK_BAND;
    if (world.x < safeL) world.x = safeL;
    if (world.x > safeR) world.x = safeR;
  } else {
    const tunnelHit = classifyGapHit(world.x, walls.left, walls.right);
    applyHit(world, tunnelHit, null);
  }

  for (const obs of world.obstacles) {
    const gap = obs.kind === "mover" ? moverGap(obs, world.time) : { left: obs.left, right: obs.right };
    const hit = hitObstacle(world.x, world.distance, obs, gap);
    applyHit(world, hit, obs);
    if (!world.alive) break;
    if (!obs.passed && world.prevDistance < obs.y && world.distance >= obs.y) {
      obs.passed = true;
      if (!obs.nicked && world.alive) {
        world.cleanPasses += 1;
        world.combo += 1;
        if (world.combo > world.comboPeak) world.comboPeak = world.combo;
      }
    }
  }

  if (!world.alive) return;

  if (world.course.finishY !== null && world.distance >= world.course.finishY) {
    world.cleared = true;
    world.distance = world.course.finishY;
    spawnClearParticles(world);
  }

  pushTrail(world);
  fadeParticles(world, dt);
}

function applyHit(world: World, hit: "none" | "nick" | "death", obs: ObstacleRuntime | null): void {
  if (hit === "none" || !world.alive) return;
  // Opening seconds are structurally wide; still honor true wall deaths.
  if (hit === "death") {
    world.alive = false;
    world.combo = 0;
    world.deathAge = 0;
    if (obs) obs.nicked = true;
    return;
  }
  if (hit === "nick") {
    if (obs) {
      if (obs.nicked) return;
      obs.nicked = true;
    } else if (world.nickTimer > 0) {
      return;
    }
    world.combo = 0;
    world.nickTimer = NICK_MS / 1000;
    world.nearMissTimer = NEAR_MISS_MS / 1000;
  }
}

function pushTrail(world: World): void {
  const last = world.trail[world.trail.length - 1];
  if (!last || Math.abs(last.x - world.x) > 0.4 || world.distance - last.d > 4) {
    world.trail.push({ x: world.x, d: world.distance });
    if (world.trail.length > TRAIL_MAX) world.trail.shift();
  } else {
    last.x = world.x;
    last.d = world.distance;
  }
}

function spawnClearParticles(world: World): void {
  if (world.reducedMotion) return;
  const count = 10;
  for (let i = 0; i < count; i++) {
    const ang = (Math.PI * 2 * i) / count + 0.2;
    const sp = 40 + (i % 3) * 18;
    world.particles.push({
      x: world.x,
      y: 0,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      life: 0.45,
      maxLife: 0.45,
    });
  }
}

function fadeParticles(world: World, dt: number): void {
  if (world.particles.length === 0) return;
  for (const p of world.particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    p.vy += 40 * dt;
  }
  world.particles = world.particles.filter((p) => p.life > 0);
}

export function deathPhase(world: World): {
  flash: number;
  dissolve: number;
  overlayReady: boolean;
} {
  if (world.alive) {
    return { flash: 0, dissolve: 0, overlayReady: false };
  }
  if (world.cleared) {
    return { flash: 0, dissolve: 0, overlayReady: true };
  }
  const ms = world.deathAge * 1000;
  const flash = world.reducedMotion
    ? 0
    : ms < DEATH_FLASH_MS
      ? 1 - ms / DEATH_FLASH_MS
      : 0;
  const dissolve = world.reducedMotion
    ? 1
    : Math.min(1, Math.max(0, (ms - DEATH_FLASH_MS) / DEATH_DISSOLVE_MS));
  return {
    flash,
    dissolve,
    overlayReady: ms >= DEATH_FREEZE_MS,
  };
}

export function interpX(world: World, alpha: number): number {
  return world.prevX + (world.x - world.prevX) * alpha;
}

export function interpDistance(world: World, alpha: number): number {
  return world.prevDistance + (world.distance - world.prevDistance) * alpha;
}

export { DIST, FIELD_W };
