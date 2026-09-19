import type { CourseSpec, ObstacleSpec, Particle, SfxCue } from "../../types.ts";
import type { Intent } from "../../types.ts";
import { skimAward, computeScore } from "../score.ts";
import type { ExperimentVariant } from "../variant.ts";
import {
  BRAKE_SLOW,
  BRAKE_SKIM_HEAT,
  CONTROL_SKIM_HEAT,
  LANE_LERP_MS,
  LANE_X,
  BEAT_COOL_MS,
  BEAT_STREAK_CAP,
  beatIntensityFromStreak,
  beatSkimParticleCount,
  beatSkimScale,
  BEAT_SKIM_PARTICLE_BASE,
} from "../variant.ts";
import { isPerfectTiming, isSkimTiming, nearestBeatIndex, beatPulseAmp } from "./beat.ts";
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
  STEER_KEY_ACCEL,
  STEER_KEY_DECEL,
  STEER_KEY_TAP_CAP,
  STEER_KEY_TAP_MS,
  STEER_SPEED,
  TENSION_CAP,
  TENSION_GAIN_LOCK_MS,
  TENSION_HOLD_MS,
  THREAD_RADIUS,
  THROUGH_FLASH_MS,
  TRAIL_MAX,
} from "./constants.ts";
import { classifyGapHit, hitObstacle, type Hit } from "./collision.ts";
import { generateCourse, moverGap, sampleWalls } from "./course.ts";
import { clampLane, laneIndexFromX, laneIsBlockedByGap, neighborLaneBlocked } from "./lanes.ts";

export type World = {
  course: CourseSpec;
  variant: ExperimentVariant;
  distance: number;
  prevDistance: number;
  x: number;
  prevX: number;
  /** Keyboard analog steer in [-1, 1]. Unused while pointer/lanes. */
  steerSmooth: number;
  /** Seconds into the current non-zero key press. 0 when released. */
  steerKeyAge: number;
  alive: boolean;
  cleared: boolean;
  nickTimer: number;
  deathAge: number;
  nearMissTimer: number;
  combo: number;
  comboPeak: number;
  cleanPasses: number;
  /** Accumulated skim / Tension cash. Center-clean does not add here. */
  skimCash: number;
  /** Successful near-miss pulses this run. Gates the distance multiplier. */
  skimEvents: number;
  /** Gray HUD "through" flash after a center-clean lip. */
  throughTimer: number;
  /** Edge for HUD: a center-clean lip this tick. */
  throughEvent: boolean;
  /** Edge for HUD: skim score ticked this tick. */
  scoreTickEvent: boolean;
  perfects: number;
  perfectFlash: number;
  lastPerfectId: number;
  /** Consecutive Beat Perfects or on-pulse skims. Feedback only. */
  beatStreak: number;
  /** Beat index last granted a streak tick (Perfect or skim). -1 = none. */
  beatCreditIndex: number;
  /** 0..1 displayed / audio heat. Cools toward streak intensity in ≤400ms. */
  beatHeat: number;
  /** 1 at beat, decays — draw uses this so mute-off is not required. */
  beatPulse: number;
  /** Latched for the shell to play an optional muteable click. */
  beatClick: boolean;
  braking: boolean;
  /** True while a Brake-held near-miss flash is active. Draw uses this for the stronger pulse. */
  brakeSkimPulse: boolean;
  /** True while an analog near-miss flash is active (Control skim juice). */
  edgeSkimPulse: boolean;
  /** Edge for Game: a Brake skim fired this tick. */
  brakeSkimEvent: boolean;
  /** Edge for Game: an on-pulse Beat skim credited this tick. */
  beatSkimEvent: boolean;
  laneIndex: number;
  laneFromX: number;
  laneToX: number;
  /** 0..1, 1 = settled. Invuln while < 1. */
  laneLerp: number;
  /** Almost-miss stacks. Cap 3. Cashed on the next skim-gated lip. Death clears. Nick does not. */
  tension: number;
  tensionTimer: number;
  tensionGainLock: number;
  time: number;
  trail: { x: number; d: number }[];
  particles: Particle[];
  reducedMotion: boolean;
  obstacles: ObstacleRuntime[];
  /** One-shots queued this tick. Drained by Game; never blocks play. */
  sfx: SfxCue[];
};

function cue(world: World, id: SfxCue): void {
  world.sfx.push(id);
}

type ObstacleRuntime = ObstacleSpec & {
  passed: boolean;
  nicked: boolean;
  /** True if the thread entered this lip's near-miss band. Omitted in older fixtures = through. */
  skimmed?: boolean;
};

function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

function approach(current: number, target: number, rate: number, dt: number): number {
  if (dt <= 0) return current;
  const delta = target - current;
  const step = rate * dt;
  if (Math.abs(delta) <= step) return target;
  return current + Math.sign(delta) * step;
}

/** KEYBOARD-STEER-FINE-v1: ramp digital ±1 intent toward analog steerSmooth. */
export function stepSteerSmooth(
  steerSmooth: number,
  steerKeyAge: number,
  intentSteer: number,
  dt: number,
): { steerSmooth: number; steerKeyAge: number } {
  const target = Math.max(-1, Math.min(1, intentSteer));
  const dir = Math.sign(target);
  if (dir === 0) {
    return {
      steerSmooth: approach(steerSmooth, 0, STEER_KEY_DECEL, dt),
      steerKeyAge: 0,
    };
  }
  const reversing = steerSmooth !== 0 && Math.sign(steerSmooth) !== dir;
  const age = reversing || steerKeyAge <= 0 ? dt : steerKeyAge + dt;
  let next = approach(steerSmooth, target, STEER_KEY_ACCEL, dt);
  if (age < STEER_KEY_TAP_MS / 1000) {
    if (dir > 0) next = Math.min(next, STEER_KEY_TAP_CAP);
    else next = Math.max(next, -STEER_KEY_TAP_CAP);
  }
  return {
    steerSmooth: Math.max(-1, Math.min(1, next)),
    steerKeyAge: age,
  };
}

function applyKeyboardSteer(world: World, intent: Intent, dt: number): void {
  const next = stepSteerSmooth(world.steerSmooth, world.steerKeyAge, intent.steer, dt);
  world.steerSmooth = next.steerSmooth;
  world.steerKeyAge = next.steerKeyAge;
  world.x += world.steerSmooth * STEER_SPEED * dt;
}

function clearKeyboardSteer(world: World): void {
  world.steerSmooth = 0;
  world.steerKeyAge = 0;
}

function applyLaneSteer(world: World, intent: Intent, dt: number): void {
  const delta = intent.laneDelta ?? 0;
  if (delta !== 0 && world.laneLerp >= 1) {
    const dest = clampLane(world.laneIndex + Math.sign(delta));
    if (dest !== world.laneIndex && !laneBlockedAhead(world, dest)) {
      world.laneFromX = world.x;
      world.laneIndex = dest;
      world.laneToX = LANE_X[dest]!;
      world.laneLerp = 0;
    }
  }
  const lerpS = LANE_LERP_MS / 1000;
  if (world.laneLerp < 1) {
    world.laneLerp = Math.min(1, world.laneLerp + dt / lerpS);
    world.x = world.laneFromX + (world.laneToX - world.laneFromX) * world.laneLerp;
  } else {
    world.x = world.laneToX;
    world.laneIndex = laneIndexFromX(world.x);
  }
}

function laneBlockedAhead(world: World, lane: number): boolean {
  const look = BASE_SPEED * (LANE_LERP_MS / 1000) + 6;
  for (const obs of world.obstacles) {
    const half = obs.thickness / 2;
    if (world.distance + look < obs.y - half || world.distance > obs.y + half) continue;
    const gap = obs.kind === "mover" ? moverGap(obs, world.time) : { left: obs.left, right: obs.right };
    if (laneIsBlockedByGap(lane, gap)) return true;
  }
  return false;
}

function applyLaneTension(world: World, gap: { left: number; right: number }, obs: ObstacleRuntime): void {
  const half = obs.thickness / 2;
  if (world.distance < obs.y - half || world.distance > obs.y + half) return;
  const lane = laneIndexFromX(world.x);
  if (laneIsBlockedByGap(lane, gap)) return;
  if (neighborLaneBlocked(lane, gap)) {
    obs.skimmed = true;
    pulseNearMiss(world);
  }
}

export function createWorld(
  seed: number,
  opts: {
    daily: boolean;
    reducedMotion: boolean;
    endlessHorizon?: number;
    variant?: ExperimentVariant;
  },
): World {
  const variant = opts.variant ?? "control";
  const course = generateCourse(seed, {
    daily: opts.daily,
    endlessHorizon: opts.endlessHorizon,
    variant: variant === "brake" || variant === "control" ? undefined : variant,
  });
  const laneIndex = 1;
  const x = variant === "lanes" ? LANE_X[laneIndex]! : FIELD_W / 2;
  return {
    course,
    variant,
    distance: 0,
    prevDistance: 0,
    x,
    prevX: x,
    steerSmooth: 0,
    steerKeyAge: 0,
    alive: true,
    cleared: false,
    nickTimer: 0,
    deathAge: 0,
    nearMissTimer: 0,
    combo: 0,
    comboPeak: 0,
    cleanPasses: 0,
    skimCash: 0,
    skimEvents: 0,
    throughTimer: 0,
    throughEvent: false,
    scoreTickEvent: false,
    perfects: 0,
    perfectFlash: 0,
    lastPerfectId: 0,
    beatStreak: 0,
    beatCreditIndex: -1,
    beatHeat: 0,
    beatPulse: 0,
    beatClick: false,
    braking: false,
    brakeSkimPulse: false,
    edgeSkimPulse: false,
    brakeSkimEvent: false,
    beatSkimEvent: false,
    laneIndex,
    laneFromX: x,
    laneToX: x,
    laneLerp: 1,
    tension: 0,
    tensionTimer: 0,
    tensionGainLock: 0,
    time: 0,
    trail: seedTrail(x),
    particles: [],
    reducedMotion: opts.reducedMotion,
    obstacles: course.obstacles.map((o) => ({ ...o, passed: false, nicked: false, skimmed: false })),
    sfx: [],
  };
}

export function worldScore(world: World): number {
  return computeScore(world.distance, world.skimCash, world.comboPeak, world.skimEvents);
}

function syncBeatHeat(world: World, dt: number): void {
  if (world.variant !== "beat") {
    world.beatStreak = 0;
    world.beatHeat = 0;
    return;
  }
  const target = beatIntensityFromStreak(world.beatStreak);
  if (world.beatHeat < target) world.beatHeat = target;
  else if (world.beatHeat > target) {
    world.beatHeat = Math.max(target, world.beatHeat - dt / (BEAT_COOL_MS / 1000));
  }
}

/** One streak tick per beat index. Shared by Perfect and on-pulse skim. */
function creditBeatStreak(world: World): boolean {
  if (world.variant !== "beat") return false;
  const index = nearestBeatIndex(world.time);
  if (world.beatCreditIndex === index) return false;
  world.beatCreditIndex = index;
  world.beatStreak = Math.min(BEAT_STREAK_CAP, world.beatStreak + 1);
  world.beatHeat = Math.max(world.beatHeat, beatIntensityFromStreak(world.beatStreak));
  return true;
}

export function updateWorld(world: World, intent: Intent, dt: number): void {
  if (!world.alive) {
    world.deathAge += dt;
    if (world.variant === "beat") world.beatStreak = 0;
    syncBeatHeat(world, dt);
    fadeParticles(world, dt);
    return;
  }
  if (world.cleared) {
    world.deathAge += dt;
    syncBeatHeat(world, dt);
    fadeParticles(world, dt);
    return;
  }

  world.prevX = world.x;
  world.prevDistance = world.distance;
  world.braking = false;
  world.brakeSkimEvent = false;
  world.beatSkimEvent = false;
  world.throughEvent = false;
  world.scoreTickEvent = false;
  world.beatClick = false;

  if (world.variant === "lanes") {
    applyLaneSteer(world, intent, dt);
    clearKeyboardSteer(world);
  } else if (intent.pointerActive) {
    const clamped = Math.max(THREAD_RADIUS, Math.min(FIELD_W - THREAD_RADIUS, intent.pointerX));
    world.x = damp(world.x, clamped, POINTER_LERP, dt);
    clearKeyboardSteer(world);
  } else {
    applyKeyboardSteer(world, intent, dt);
  }
  world.x = Math.max(THREAD_RADIUS, Math.min(FIELD_W - THREAD_RADIUS, world.x));

  let speeding = world.nickTimer > 0 ? NICK_SLOW : 1;
  if (world.variant === "brake" && intent.brake) {
    world.braking = true;
    // Feel-sanity: combined brake+nick must not drop below NICK_SLOW.
    speeding = Math.max(NICK_SLOW, speeding * BRAKE_SLOW);
  }
  world.distance += BASE_SPEED * speeding * dt;
  world.time += dt;
  if (world.nickTimer > 0) world.nickTimer = Math.max(0, world.nickTimer - dt);
  if (world.nearMissTimer > 0) {
    world.nearMissTimer = Math.max(0, world.nearMissTimer - dt);
    if (world.nearMissTimer === 0) {
      world.brakeSkimPulse = false;
      world.edgeSkimPulse = false;
    }
  }
  if (world.perfectFlash > 0) world.perfectFlash = Math.max(0, world.perfectFlash - dt);
  if (world.throughTimer > 0) world.throughTimer = Math.max(0, world.throughTimer - dt);
  if (world.variant === "beat") {
    const prevPulse = world.beatPulse;
    world.beatPulse = beatPulseAmp(world.time);
    if (world.beatPulse > 0.6 && prevPulse <= 0.6) world.beatClick = true;
  } else {
    world.beatPulse = 0;
  }
  if (world.tensionGainLock > 0) world.tensionGainLock = Math.max(0, world.tensionGainLock - dt);
  if (world.tensionTimer > 0) {
    world.tensionTimer = Math.max(0, world.tensionTimer - dt);
    if (world.tensionTimer === 0) world.tension = 0;
  }
  fadeParticles(world, dt);

  const laneInvuln = world.variant === "lanes" && world.laneLerp < 1;

  const walls = sampleWalls(world.course.keyframes, world.distance);
  if (world.distance < DIST.openEnd) {
    const safeL = walls.left + THREAD_RADIUS + NICK_BAND;
    const safeR = walls.right - THREAD_RADIUS - NICK_BAND;
    if (world.x < safeL) world.x = safeL;
    if (world.x > safeR) world.x = safeR;
  } else if (!laneInvuln) {
    const tunnelHit = classifyGapHit(world.x, walls.left, walls.right);
    if (world.variant === "lanes") {
      if (tunnelHit === "death") applyHit(world, tunnelHit, null);
    } else {
      applyHit(world, tunnelHit, null);
    }
  }

  for (const obs of world.obstacles) {
    const gap = obs.kind === "mover" ? moverGap(obs, world.time) : { left: obs.left, right: obs.right };
    const hit = hitObstacle(world.x, world.distance, obs, gap);
    if (world.variant === "lanes") {
      if (!laneInvuln && (hit === "death" || hit === "nick")) applyHit(world, hit === "nick" ? "death" : hit, obs);
      applyLaneTension(world, gap, obs);
    } else {
      applyHit(world, hit, obs);
    }
    if (!world.alive) break;
    if (!obs.passed && world.prevDistance < obs.y && world.distance >= obs.y) {
      obs.passed = true;
      const lanesDenied =
        world.variant === "lanes" &&
        (world.x < gap.left + THREAD_RADIUS || world.x > gap.right - THREAD_RADIUS);
      if (!obs.nicked && world.alive && !lanesDenied) {
        world.cleanPasses += 1;
        if (obs.skimmed) {
          // Skim-gated lip: the only style payout. Combo / Tension cash live here.
          world.combo += 1;
          if (world.combo > world.comboPeak) world.comboPeak = world.combo;
          world.skimCash += skimAward(world.tension);
          world.tension = 0;
          world.tensionTimer = 0;
          world.scoreTickEvent = true;
          cue(world, "clean");
        } else {
          // Center-clean: gray "through" only. Not combo food. Score 0.
          world.throughTimer = THROUGH_FLASH_MS / 1000;
          world.throughEvent = true;
        }
        if (world.variant === "beat") {
          if (isPerfectTiming(world.time, Boolean(intent.touchScoring || intent.pointerActive))) {
            world.perfects += 1;
            world.perfectFlash = 0.16;
            world.lastPerfectId = obs.id;
            creditBeatStreak(world);
          } else {
            world.beatStreak = 0;
          }
        }
      }
    }
  }

  syncBeatHeat(world, dt);

  if (!world.alive) return;

  if (world.course.finishY !== null && world.distance >= world.course.finishY) {
    world.cleared = true;
    world.alive = false;
    world.distance = world.course.finishY;
    cue(world, "clear");
    spawnClearParticles(world);
  }

  pushTrail(world);
}

function applyHit(world: World, hit: Hit, obs: ObstacleRuntime | null): void {
  if (hit === "none" || !world.alive) return;
  // Opening seconds are structurally wide; still honor true wall deaths.
  if (hit === "death") {
    world.alive = false;
    world.combo = 0;
    world.tension = 0;
    world.tensionTimer = 0;
    world.tensionGainLock = 0;
    world.deathAge = 0;
    if (world.variant === "beat") world.beatStreak = 0;
    if (obs) obs.nicked = true;
    cue(world, "death");
    return;
  }
  if (hit === "nearMiss") {
    if (obs) obs.skimmed = true;
    pulseNearMiss(world);
    return;
  }
  if (hit === "nick") {
    if (obs) {
      if (obs.nicked) return;
      obs.nicked = true;
    } else if (world.nickTimer > 0) {
      return;
    }
    // Combo and Tension survive a nick. Slow-mo stays a timing tool; this obstacle is not Clean.
    const fresh = world.nickTimer <= 0;
    world.nickTimer = NICK_MS / 1000;
    world.nearMissTimer = NEAR_MISS_MS / 1000;
    if (world.variant === "beat") world.beatStreak = 0;
    if (fresh) cue(world, "nick");
  }
}

function pulseNearMiss(world: World): void {
  if (world.tensionGainLock > 0) return;
  world.tension = Math.min(TENSION_CAP, world.tension + 1);
  world.tensionTimer = TENSION_HOLD_MS / 1000;
  world.tensionGainLock = TENSION_GAIN_LOCK_MS / 1000;
  world.nearMissTimer = NEAR_MISS_MS / 1000;
  world.edgeSkimPulse = true;
  world.skimEvents += 1;
  world.scoreTickEvent = true;
  const brakingSkim = world.variant === "brake" && world.braking;
  if (brakingSkim) {
    world.brakeSkimEvent = true;
    if (!world.reducedMotion) world.brakeSkimPulse = true;
  }
  cue(world, "tension");
  if (!world.reducedMotion) spawnNearMissParticles(world);
  // BEAT-SKIM-MASTERY-v1: juice uses current heat; credit after so this skim does not double.
  // BEAT-FORGIVE-RUNG-v1: off-pulse near-miss is exactly −1 streak, not wipe.
  if (world.variant === "beat") {
    if (isSkimTiming(world.time, world.beatStreak)) {
      if (creditBeatStreak(world)) world.beatSkimEvent = true;
    } else {
      world.beatStreak = Math.max(0, world.beatStreak - 1);
    }
  }
}

/** Visual near-miss heat. Brake skim uses a modest cap; Beat uses streak heat; Control uses edge skim. */
export function skimJuice(world: World): number {
  if (world.reducedMotion) return 0;
  if (world.variant === "beat") return world.beatHeat;
  if (world.brakeSkimPulse) return BRAKE_SKIM_HEAT;
  if (world.edgeSkimPulse) return CONTROL_SKIM_HEAT;
  return 0;
}

function spawnNearMissParticles(world: World): void {
  const heat = skimJuice(world);
  const count = beatSkimParticleCount(heat);
  const scale = beatSkimScale(heat);
  for (let i = 0; i < count; i++) {
    const ang = (Math.PI * 2 * i) / count + 0.15;
    const sp = (18 + (i % 2) * 10) * scale;
    world.particles.push({
      x: world.x,
      y: 0,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      life: 0.22,
      maxLife: 0.22,
      ink: i >= BEAT_SKIM_PARTICLE_BASE,
    });
  }
}

function seedTrail(x: number): { x: number; d: number }[] {
  const pts: { x: number; d: number }[] = [];
  for (let i = 18; i >= 0; i--) {
    pts.push({ x, d: -i * 10 });
  }
  return pts;
}

function pushTrail(world: World): void {
  const last = world.trail[world.trail.length - 1];
  if (!last) {
    world.trail.push({ x: world.x, d: world.distance });
    return;
  }
  const dd = world.distance - last.d;
  const dx = Math.abs(last.x - world.x);
  if (dd > 3 || dx > 0.6) {
    world.trail.push({ x: world.x, d: world.distance });
    if (world.trail.length > TRAIL_MAX) world.trail.shift();
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
  if (world.cleared) {
    return { flash: 0, dissolve: 0, overlayReady: true };
  }
  if (world.alive) {
    return { flash: 0, dissolve: 0, overlayReady: false };
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
