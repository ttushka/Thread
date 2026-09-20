import type { CanvasHandle } from "./canvas.ts";
import { withPlayfield } from "./canvas.ts";
import {
  deathPhase,
  interpDistance,
  interpX,
  scoreTickEdgeOn,
  scoreTickFilamentOn,
  skimJuice,
  type World,
} from "../world/simulate.ts";
import { moverGap, sampleWalls, slabPair } from "../world/course.ts";
import {
  FIELD_H,
  FIELD_W,
  THREAD_SCREEN_Y,
  VIEW_AHEAD,
  VIEW_BEHIND,
} from "../world/constants.ts";
import { LANE_GUIDES, BEAT_PULSE_SCALE_MAX, BEAT_GLOW_BLUR_MAX, beatSkimScale } from "../variant.ts";
import { railBloomHeat, railContact, railScoreBloomOn } from "../world/rail.ts";

const BG_DEEP = "#0B0D10";
const INK = "#E8EAED";
const THREAD = "#5EEAD4";
const THREAD_DIM = "#2A6F66";
const DANGER = "#F07178";
const INK_MUTED = "#8B919A";

/**
 * WALL-MOVER-POLISH-BRIEF-v1 — palette / stroke / fill / soft depth only.
 * Inner shade is ≤8% toward --bg-deep, not a second hue.
 * Teal is reserved for the live thread and the Edge Rail (IDENTITY-EDGE-RAIL-v1).
 */
export const WALL_ART = {
  obstacle: "#3D4450",
  obstacleEdge: "#5A6270",
  pinchLip: "#161A22",
  pinchLipEdge: "#B8C0CC",
  /** Design-locked 2.5–3px; brighter/thicker than the 2px tunnel stroke. */
  pinchLipStroke: 3,
  mover: "#242A34",
  moverEdge: "#A8B0BC",
  moverStroke: 2,
  innerShade: 0.08,
  wallShadePx: 8,
  slabShadePx: 7,
  contactShadowBlur: 6,
  contactShadowAlpha: 0.18,
} as const;

/** Award-tick tokens. Lip stroke stays pinch-lip-edge; teal lives on thread + rail. */
export const SCORE_TICK_ART = {
  filament: THREAD,
  edge: WALL_ART.pinchLipEdge,
} as const;

/**
 * IDENTITY-EDGE-RAIL-v1 — always-on inner-edge filament.
 * Teal allowed on the rail and the live thread only. Visual band, not a collider.
 */
export const EDGE_RAIL_ART = {
  color: THREAD,
  idleWidth: 1.55,
  idleAlpha: 0.4,
  idleBlur: 5,
  bloomWidth: 3.35,
  bloomAlpha: 0.96,
  bloomBlur: 14,
  scoreWidth: 4.1,
  scoreBlur: 18,
  /** Local bloom along Y — wider than the skim band so it reads as a ride, not a grind. */
  contactBand: 64,
  inset: 1.35,
} as const;

/** Mid-corridor fill stays darker/flatter than the glowing rail. */
export const PLAYFIELD_ART = {
  panel: "#0E1014",
  centerDimAlpha: 0.3,
} as const;

function parseHex(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixToward(hex: string, toward: string, t: number): string {
  const a = parseHex(hex);
  const b = parseHex(toward);
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bch = Math.round(a[2] + (b[2] - a[2]) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bch).toString(16).slice(1).toUpperCase()}`;
}

function rgba(hex: string, a: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${a})`;
}

const OBSTACLE_INNER = mixToward(WALL_ART.obstacle, BG_DEEP, WALL_ART.innerShade);
const PINCH_LIP_INNER = mixToward(WALL_ART.pinchLip, BG_DEEP, WALL_ART.innerShade);
const MOVER_INNER = mixToward(WALL_ART.mover, BG_DEEP, WALL_ART.innerShade);

function worldToScreen(worldY: number, camera: number): number {
  return THREAD_SCREEN_Y - (worldY - camera);
}

export function drawFrame(
  handle: CanvasHandle,
  world: World | null,
  alpha: number,
  titleIdle: boolean,
): void {
  const { ctx, cssW, cssH, map } = handle;
  ctx.fillStyle = BG_DEEP;
  ctx.fillRect(0, 0, cssW, cssH);

  withPlayfield(ctx, map, () => {
    ctx.fillStyle = PLAYFIELD_ART.panel;
    ctx.fillRect(0, 0, FIELD_W, FIELD_H);

    if (!world) {
      drawIdleRibbon(ctx, titleIdle);
      drawVignette(ctx);
      return;
    }

    const camera = interpDistance(world, alpha);
    const x = interpX(world, alpha);
    drawTunnel(ctx, world, camera);
    if (world.variant === "lanes") drawLaneGuides(ctx);
    drawSlabs(ctx, world, camera);
    drawEdgeRail(ctx, world, camera);
    if (world.course.finishY !== null) drawFinish(ctx, world.course.finishY, camera);
    drawThread(ctx, world, camera, x);
    drawParticles(ctx, world);
    if (world.variant === "beat") drawBeatPulse(ctx, world);
    const phase = deathPhase(world);
    if (!world.alive && !world.cleared && phase.flash > 0) {
      ctx.fillStyle = rgba(DANGER, 0.22 * phase.flash);
      ctx.fillRect(0, 0, FIELD_W, FIELD_H);
    }
    drawVignette(ctx, world.variant === "beat" && !world.reducedMotion ? world.beatHeat : 0);
  });
}

function drawIdleRibbon(ctx: CanvasRenderingContext2D, animate: boolean): void {
  const t = animate ? performance.now() / 1000 : 0;
  ctx.beginPath();
  for (let i = 0; i <= 48; i++) {
    const y = 80 + i * 10;
    const x = FIELD_W / 2 + Math.sin(i * 0.22 + t * 0.6) * (18 + i * 0.15);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = THREAD_DIM;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.strokeStyle = THREAD;
  ctx.lineWidth = 2.2;
  ctx.stroke();
}

function drawTunnel(ctx: CanvasRenderingContext2D, world: World, camera: number): void {
  const y0 = camera - VIEW_BEHIND - 20;
  const y1 = camera + VIEW_AHEAD + 20;
  const step = 8;
  const left: { x: number; sy: number }[] = [];
  const right: { x: number; sy: number }[] = [];
  for (let y = y0; y <= y1; y += step) {
    const w = sampleWalls(world.course.keyframes, y);
    const sy = worldToScreen(y, camera);
    left.push({ x: w.left, sy });
    right.push({ x: w.right, sy });
  }

  const y0s = worldToScreen(y0, camera);
  const y1s = worldToScreen(y1, camera);
  fillWallSlab(ctx, "left", left, y0s, y1s);
  fillWallSlab(ctx, "right", right, y0s, y1s);
  drawCenterDead(ctx, left, right);

  ctx.strokeStyle = WALL_ART.obstacleEdge;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  left.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.sy) : ctx.lineTo(p.x, p.sy)));
  ctx.stroke();
  ctx.beginPath();
  right.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.sy) : ctx.lineTo(p.x, p.sy)));
  ctx.stroke();
}

/** Mid-corridor dim — edges stay readable so the rail is the subject. */
function drawCenterDead(
  ctx: CanvasRenderingContext2D,
  left: { x: number; sy: number }[],
  right: { x: number; sy: number }[],
): void {
  if (left.length === 0 || right.length === 0) return;
  ctx.save();
  ctx.beginPath();
  left.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.sy) : ctx.lineTo(p.x, p.sy)));
  for (let i = right.length - 1; i >= 0; i--) {
    const p = right[i]!;
    ctx.lineTo(p.x, p.sy);
  }
  ctx.closePath();
  ctx.clip();
  const g = ctx.createLinearGradient(0, 0, FIELD_W, 0);
  const a = PLAYFIELD_ART.centerDimAlpha;
  g.addColorStop(0, "rgba(11,13,16,0)");
  g.addColorStop(0.28, rgba(BG_DEEP, a));
  g.addColorStop(0.5, rgba(BG_DEEP, a));
  g.addColorStop(0.72, rgba(BG_DEEP, a));
  g.addColorStop(1, "rgba(11,13,16,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);
  ctx.restore();
}

function insetRailEdge(
  side: "left" | "right",
  edge: { x: number; sy: number }[],
): { x: number; sy: number }[] {
  const inset = EDGE_RAIL_ART.inset;
  return edge.map((p) => ({ x: side === "left" ? p.x + inset : p.x - inset, sy: p.sy }));
}

function strokeRailPolyline(
  ctx: CanvasRenderingContext2D,
  edge: { x: number; sy: number }[],
  width: number,
  alpha: number,
  blur: number,
): void {
  if (edge.length === 0) return;
  ctx.save();
  ctx.strokeStyle = rgba(EDGE_RAIL_ART.color, alpha);
  ctx.shadowColor = rgba(EDGE_RAIL_ART.color, Math.min(1, alpha + 0.15));
  ctx.shadowBlur = blur;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  edge.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.sy) : ctx.lineTo(p.x, p.sy)));
  ctx.stroke();
  ctx.restore();
}

function strokeRailBand(
  ctx: CanvasRenderingContext2D,
  edge: { x: number; sy: number }[],
  focusSy: number,
  band: number,
  width: number,
  alpha: number,
  blur: number,
): void {
  ctx.save();
  ctx.strokeStyle = rgba(EDGE_RAIL_ART.color, alpha);
  ctx.shadowColor = rgba(EDGE_RAIL_ART.color, 0.95);
  ctx.shadowBlur = blur;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  let started = false;
  for (const p of edge) {
    if (Math.abs(p.sy - focusSy) > band) {
      started = false;
      continue;
    }
    if (!started) {
      ctx.moveTo(p.x, p.sy);
      started = true;
    } else {
      ctx.lineTo(p.x, p.sy);
    }
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Always-on teal rail on the inner playable edge. Blooms in the skim/nick
 * band and louder on a skim score tick. Brake in the center does not light it.
 */
function drawEdgeRail(ctx: CanvasRenderingContext2D, world: World, camera: number): void {
  const y0 = camera - VIEW_BEHIND - 20;
  const y1 = camera + VIEW_AHEAD + 20;
  const step = 8;
  const left: { x: number; sy: number }[] = [];
  const right: { x: number; sy: number }[] = [];
  for (let y = y0; y <= y1; y += step) {
    const w = sampleWalls(world.course.keyframes, y);
    const sy = worldToScreen(y, camera);
    left.push({ x: w.left, sy });
    right.push({ x: w.right, sy });
  }
  const railL = insetRailEdge("left", left);
  const railR = insetRailEdge("right", right);

  strokeRailPolyline(ctx, railL, EDGE_RAIL_ART.idleWidth, EDGE_RAIL_ART.idleAlpha, EDGE_RAIL_ART.idleBlur);
  strokeRailPolyline(ctx, railR, EDGE_RAIL_ART.idleWidth, EDGE_RAIL_ART.idleAlpha, EDGE_RAIL_ART.idleBlur);

  const heat = railBloomHeat(world);
  const contact = railContact(world);
  if (heat > 0 && contact.side) {
    const edge = contact.side === "left" ? railL : railR;
    const width = EDGE_RAIL_ART.idleWidth + (EDGE_RAIL_ART.bloomWidth - EDGE_RAIL_ART.idleWidth) * heat;
    const blur = EDGE_RAIL_ART.idleBlur + (EDGE_RAIL_ART.bloomBlur - EDGE_RAIL_ART.idleBlur) * heat;
    const alpha = EDGE_RAIL_ART.idleAlpha + (EDGE_RAIL_ART.bloomAlpha - EDGE_RAIL_ART.idleAlpha) * heat;
    strokeRailBand(ctx, edge, THREAD_SCREEN_Y, EDGE_RAIL_ART.contactBand, width, alpha, blur);
  }

  if (railScoreBloomOn(world) && world.scoreTickSide) {
    const edge = world.scoreTickSide === "left" ? railL : railR;
    const lip = world.obstacles.find((o) => o.id === world.scoreTickLipId);
    const focusSy = worldToScreen(lip?.y ?? camera, camera);
    strokeRailBand(
      ctx,
      edge,
      focusSy,
      EDGE_RAIL_ART.contactBand,
      EDGE_RAIL_ART.scoreWidth,
      EDGE_RAIL_ART.bloomAlpha,
      EDGE_RAIL_ART.scoreBlur,
    );
  }

  drawLipRails(ctx, world, camera, heat, contact);
}

function drawLipRails(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: number,
  heat: number,
  contact: { side: "left" | "right" | null; riding: boolean; lipId: number },
): void {
  for (const obs of world.obstacles) {
    const sy = worldToScreen(obs.y, camera);
    if (sy < -40 || sy > FIELD_H + 40) continue;
    const gap = obs.kind === "mover" ? moverGap(obs, world.time) : { left: obs.left, right: obs.right };
    const bars = slabPair(obs.y, obs.thickness, gap);
    const top = sy - bars.left.h / 2;
    const scoreLeft = railScoreBloomOn(world) && world.scoreTickLipId === obs.id && world.scoreTickSide === "left";
    const scoreRight = railScoreBloomOn(world) && world.scoreTickLipId === obs.id && world.scoreTickSide === "right";
    const rideLeft = contact.lipId === obs.id && contact.side === "left" && heat > 0;
    const rideRight = contact.lipId === obs.id && contact.side === "right" && heat > 0;
    strokeLipRail(ctx, gap.left + EDGE_RAIL_ART.inset, top, bars.left.h, scoreLeft, rideLeft, heat);
    strokeLipRail(ctx, gap.right - EDGE_RAIL_ART.inset, top, bars.right.h, scoreRight, rideRight, heat);
  }
}

function strokeLipRail(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  h: number,
  score: boolean,
  riding: boolean,
  heat: number,
): void {
  if (h <= 0) return;
  const bloom = score || riding;
  const width = score
    ? EDGE_RAIL_ART.scoreWidth
    : riding
      ? EDGE_RAIL_ART.idleWidth + (EDGE_RAIL_ART.bloomWidth - EDGE_RAIL_ART.idleWidth) * heat
      : EDGE_RAIL_ART.idleWidth;
  const blur = score
    ? EDGE_RAIL_ART.scoreBlur
    : riding
      ? EDGE_RAIL_ART.idleBlur + (EDGE_RAIL_ART.bloomBlur - EDGE_RAIL_ART.idleBlur) * heat
      : EDGE_RAIL_ART.idleBlur;
  const alpha = bloom ? EDGE_RAIL_ART.bloomAlpha : EDGE_RAIL_ART.idleAlpha;
  ctx.save();
  ctx.strokeStyle = rgba(EDGE_RAIL_ART.color, alpha);
  ctx.shadowColor = rgba(EDGE_RAIL_ART.color, bloom ? 0.95 : Math.min(1, alpha + 0.15));
  ctx.shadowBlur = blur;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, top + h);
  ctx.stroke();
  ctx.restore();
}

/** Corridor mass: fill + inner-face shade (≤8% toward bg-deep). No gloss/noise. */
function fillWallSlab(
  ctx: CanvasRenderingContext2D,
  side: "left" | "right",
  edge: { x: number; sy: number }[],
  y0s: number,
  y1s: number,
): void {
  const inset = WALL_ART.wallShadePx;
  ctx.fillStyle = OBSTACLE_INNER;
  wallPath(ctx, side, edge, y0s, y1s, 0);
  ctx.fill();
  ctx.fillStyle = WALL_ART.obstacle;
  wallPath(ctx, side, edge, y0s, y1s, inset);
  ctx.fill();
}

function wallPath(
  ctx: CanvasRenderingContext2D,
  side: "left" | "right",
  edge: { x: number; sy: number }[],
  y0s: number,
  y1s: number,
  inset: number,
): void {
  ctx.beginPath();
  if (side === "left") {
    ctx.moveTo(0, y0s);
    for (const p of edge) ctx.lineTo(p.x - inset, p.sy);
    ctx.lineTo(0, y1s);
  } else {
    ctx.moveTo(FIELD_W, y0s);
    for (const p of edge) ctx.lineTo(p.x + inset, p.sy);
    ctx.lineTo(FIELD_W, y1s);
  }
  ctx.closePath();
}

function drawSlabs(ctx: CanvasRenderingContext2D, world: World, camera: number): void {
  for (const obs of world.obstacles) {
    const sy = worldToScreen(obs.y, camera);
    if (sy < -40 || sy > FIELD_H + 40) continue;
    const gap = obs.kind === "mover" ? moverGap(obs, world.time) : { left: obs.left, right: obs.right };
    const bars = slabPair(obs.y, obs.thickness, gap);
    const top = sy - bars.left.h / 2;
    const isGate = obs.kind === "gate";
    const visualHeat = world.variant === "beat" && !world.reducedMotion ? world.beatHeat : 0;
    const perfect = world.variant === "beat" && world.perfectFlash > 0 && obs.id === world.lastPerfectId;
    const glow = visualHeat * BEAT_GLOW_BLUR_MAX * (perfect ? 1 : isGate ? 0.25 : 0);
    const base = isGate
      ? {
          fill: perfect ? INK : WALL_ART.pinchLip,
          inner: perfect ? INK : PINCH_LIP_INNER,
          edge: perfect ? INK : WALL_ART.pinchLipEdge,
          lineWidth: perfect ? WALL_ART.pinchLipStroke + 0.4 + 0.6 * visualHeat : WALL_ART.pinchLipStroke,
          glow,
        }
      : {
          fill: WALL_ART.mover,
          inner: MOVER_INNER,
          edge: WALL_ART.moverEdge,
          lineWidth: WALL_ART.moverStroke,
          glow: 0,
        };
    drawCraftedBar(ctx, bars.left, top, withScoreTickEdge(world, obs.id, "left", base), "left");
    drawCraftedBar(ctx, bars.right, top, withScoreTickEdge(world, obs.id, "right", base), "right");
  }
}

/** Local awarding lip stroke → pinch-lip-edge. Teal bloom lives on the rail. */
export function withScoreTickEdge(
  world: World,
  obsId: number,
  side: "left" | "right",
  style: { fill: string; inner: string; edge: string; lineWidth: number; glow?: number },
): { fill: string; inner: string; edge: string; lineWidth: number; glow?: number } {
  if (!scoreTickLocalEdgeOn(world, obsId, side)) return style;
  return {
    ...style,
    edge: WALL_ART.pinchLipEdge,
    lineWidth: Math.max(style.lineWidth, WALL_ART.pinchLipStroke + 1.1),
  };
}

export function scoreTickLocalEdgeOn(world: World, obsId: number, side: "left" | "right"): boolean {
  return (
    !world.reducedMotion &&
    scoreTickEdgeOn(world) &&
    world.scoreTickLipId === obsId &&
    world.scoreTickSide === side
  );
}

function drawCraftedBar(
  ctx: CanvasRenderingContext2D,
  bar: { x: number; w: number; h: number },
  top: number,
  style: { fill: string; inner: string; edge: string; lineWidth: number; glow?: number },
  facing: "left" | "right",
): void {
  if (bar.w <= 0 || bar.h <= 0) return;

  ctx.save();
  const glow = Math.min(BEAT_GLOW_BLUR_MAX, style.glow ?? 0);
  ctx.shadowColor = glow > 0 ? rgba(INK, WALL_ART.contactShadowAlpha + 0.22 * Math.min(1, glow / BEAT_GLOW_BLUR_MAX)) : rgba(BG_DEEP, WALL_ART.contactShadowAlpha);
  ctx.shadowBlur = glow > 0 ? glow : WALL_ART.contactShadowBlur;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = glow > 0 ? 0 : 3;
  ctx.fillStyle = style.fill;
  roundRect(ctx, bar.x, top, bar.w, bar.h, 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, bar.x, top, bar.w, bar.h, 2);
  ctx.clip();
  ctx.fillStyle = style.inner;
  const shade = Math.min(WALL_ART.slabShadePx, bar.w);
  if (facing === "left") ctx.fillRect(bar.x + bar.w - shade, top, shade, bar.h);
  else ctx.fillRect(bar.x, top, shade, bar.h);
  ctx.restore();

  ctx.strokeStyle = style.edge;
  ctx.lineWidth = style.lineWidth;
  ctx.lineJoin = "round";
  roundRect(ctx, bar.x, top, bar.w, bar.h, 2);
  ctx.stroke();
}

function drawLaneGuides(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = rgba(INK_MUTED, 0.12);
  ctx.lineWidth = 1;
  for (const x of LANE_GUIDES) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, FIELD_H);
    ctx.stroke();
  }
}

/** Playfield-edge metronome. Ink-muted only — readable with the click muted. */
function drawBeatPulse(ctx: CanvasRenderingContext2D, world: World): void {
  const amp = Math.max(0.16, world.beatPulse);
  const heat = world.reducedMotion ? 0 : world.beatHeat;
  const scale = 1 + (BEAT_PULSE_SCALE_MAX - 1) * heat;
  const glow = Math.min(BEAT_GLOW_BLUR_MAX, BEAT_GLOW_BLUR_MAX * heat);
  const w = (FIELD_W - 8) * scale;
  const h = (FIELD_H - 8) * scale;
  ctx.save();
  ctx.shadowColor = rgba(INK_MUTED, 0.35 * heat);
  ctx.shadowBlur = glow;
  ctx.strokeStyle = rgba(INK_MUTED, 0.2 + 0.55 * world.beatPulse + 0.18 * heat);
  ctx.lineWidth = 3 + 3 * amp;
  ctx.strokeRect(FIELD_W / 2 - w / 2, FIELD_H / 2 - h / 2, w, h);
  ctx.restore();
}

function drawFinish(ctx: CanvasRenderingContext2D, finishY: number, camera: number): void {
  const sy = worldToScreen(finishY, camera);
  if (sy < -10 || sy > FIELD_H + 10) return;
  ctx.strokeStyle = THREAD_DIM;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(24, sy);
  ctx.lineTo(FIELD_W - 24, sy);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = THREAD;
  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("finish", FIELD_W / 2, sy - 8);
}

function drawThread(ctx: CanvasRenderingContext2D, world: World, camera: number, x: number): void {
  const phase = deathPhase(world);
  const dissolve = world.alive || world.cleared ? 0 : phase.dissolve;
  if (dissolve >= 1) return;

  const award = !world.reducedMotion && scoreTickFilamentOn(world) && world.alive;
  const bright = world.nearMissTimer > 0 && world.alive;
  const charged = world.tension > 0 && world.alive;
  const juice = award ? 1 : bright ? skimJuice(world) : 0;
  const scale = beatSkimScale(juice);
  ctx.globalAlpha = 1 - dissolve;

  ctx.beginPath();
  const pts = world.trail;
  if (pts.length > 0) {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const sx = i === pts.length - 1 ? x : p.x;
      const sy = worldToScreen(p.d, camera);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    const headSy = worldToScreen(camera, camera);
    ctx.lineTo(x, headSy);
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = THREAD;
  ctx.shadowBlur = award ? 36 * scale : bright ? 30 * scale : charged ? 16 : 12;
  ctx.strokeStyle = award ? THREAD : THREAD_DIM;
  ctx.lineWidth = award ? 12.5 * scale : bright ? 11.5 * scale : 8;
  ctx.stroke();
  ctx.strokeStyle = award ? THREAD : bright ? INK : THREAD;
  ctx.lineWidth = award ? 5.6 * scale : bright ? 5.2 * scale : 3.4;
  ctx.stroke();
  ctx.shadowBlur = 0;

  const headSy = THREAD_SCREEN_Y;
  ctx.fillStyle = award || !bright ? THREAD : INK;
  ctx.beginPath();
  ctx.arc(x, headSy, award ? 5.6 * scale : bright ? 5.2 * scale : 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawParticles(ctx: CanvasRenderingContext2D, world: World): void {
  if (world.particles.length === 0) return;
  for (const p of world.particles) {
    const a = p.life / p.maxLife;
    ctx.fillStyle = rgba(p.ink ? INK : THREAD, a);
    ctx.fillRect(p.x - 1.2, THREAD_SCREEN_Y - p.y - 1.2, 2.4, 2.4);
  }
}

function drawVignette(ctx: CanvasRenderingContext2D, heat = 0): void {
  const g = ctx.createRadialGradient(
    FIELD_W / 2,
    FIELD_H * 0.55,
    FIELD_W * 0.2,
    FIELD_W / 2,
    FIELD_H * 0.5,
    FIELD_H * 0.72,
  );
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(11,13,16,${0.55 + 0.12 * Math.min(1, Math.max(0, heat))})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
