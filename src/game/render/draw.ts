import type { CanvasHandle } from "./canvas.ts";
import { withPlayfield } from "./canvas.ts";
import type { World } from "../world/simulate.ts";
import { deathPhase, interpDistance, interpX } from "../world/simulate.ts";
import { moverGap, sampleWalls, slabPair } from "../world/course.ts";
import {
  FIELD_H,
  FIELD_W,
  THREAD_SCREEN_Y,
  VIEW_AHEAD,
  VIEW_BEHIND,
} from "../world/constants.ts";

const BG_DEEP = "#0B0D10";
const BG_PANEL = "#12151A";
const INK = "#E8EAED";
const THREAD = "#5EEAD4";
const THREAD_DIM = "#2A6F66";
const OBSTACLE = "#3D4450";
const OBSTACLE_EDGE = "#5A6270";
/** Sharper than tunnel stroke so static lips read as a gate, not wall noise. */
const GATE_LIP_EDGE = "#8A93A3";
const DANGER = "#F07178";
const LIP_FACE = 2.5;

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
    ctx.fillStyle = BG_PANEL;
    ctx.fillRect(0, 0, FIELD_W, FIELD_H);

    if (!world) {
      drawIdleRibbon(ctx, titleIdle);
      drawVignette(ctx);
      return;
    }

    const camera = interpDistance(world, alpha);
    const x = interpX(world, alpha);
    drawTunnel(ctx, world, camera);
    drawSlabs(ctx, world, camera);
    if (world.course.finishY !== null) drawFinish(ctx, world.course.finishY, camera);
    drawThread(ctx, world, camera, x);
    drawParticles(ctx, world);
    const phase = deathPhase(world);
    if (!world.alive && !world.cleared && phase.flash > 0) {
      ctx.fillStyle = rgba(DANGER, 0.22 * phase.flash);
      ctx.fillRect(0, 0, FIELD_W, FIELD_H);
    }
    drawVignette(ctx);
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

  ctx.fillStyle = BG_DEEP;
  ctx.beginPath();
  ctx.moveTo(0, worldToScreen(y0, camera));
  for (const p of left) ctx.lineTo(p.x, p.sy);
  ctx.lineTo(0, worldToScreen(y1, camera));
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(FIELD_W, worldToScreen(y0, camera));
  for (const p of right) ctx.lineTo(p.x, p.sy);
  ctx.lineTo(FIELD_W, worldToScreen(y1, camera));
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = OBSTACLE_EDGE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  left.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.sy) : ctx.lineTo(p.x, p.sy)));
  ctx.stroke();
  ctx.beginPath();
  right.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.sy) : ctx.lineTo(p.x, p.sy)));
  ctx.stroke();
}

function drawSlabs(ctx: CanvasRenderingContext2D, world: World, camera: number): void {
  for (const obs of world.obstacles) {
    const sy = worldToScreen(obs.y, camera);
    if (sy < -40 || sy > FIELD_H + 40) continue;
    const gap = obs.kind === "mover" ? moverGap(obs, world.time) : { left: obs.left, right: obs.right };
    const bars = slabPair(obs.y, obs.thickness, gap);
    const top = sy - bars.left.h / 2;
    const isGate = obs.kind === "gate";
    ctx.fillStyle = OBSTACLE;
    ctx.strokeStyle = isGate ? GATE_LIP_EDGE : OBSTACLE_EDGE;
    ctx.lineWidth = isGate ? 1.6 : 1.2;
    roundRect(ctx, bars.left.x, top, bars.left.w, bars.left.h, 2);
    ctx.fill();
    ctx.stroke();
    roundRect(ctx, bars.right.x, top, bars.right.w, bars.right.h, 2);
    ctx.fill();
    ctx.stroke();
    if (isGate) drawGateFaces(ctx, gap, top, bars.left.h);
  }
}

/** Kill-hazard token on the inner bar face — contact here nicks/kills like a wall. */
function drawGateFaces(
  ctx: CanvasRenderingContext2D,
  gap: { left: number; right: number },
  top: number,
  h: number,
): void {
  ctx.fillStyle = DANGER;
  ctx.fillRect(gap.left - LIP_FACE, top, LIP_FACE, h);
  ctx.fillRect(gap.right, top, LIP_FACE, h);
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

  const bright = world.nearMissTimer > 0 && world.alive;
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
  ctx.shadowBlur = bright ? 22 : 12;
  ctx.strokeStyle = THREAD_DIM;
  ctx.lineWidth = bright ? 9.5 : 8;
  ctx.stroke();
  ctx.strokeStyle = bright ? INK : THREAD;
  ctx.lineWidth = bright ? 4.2 : 3.4;
  ctx.stroke();
  ctx.shadowBlur = 0;

  const headSy = THREAD_SCREEN_Y;
  ctx.fillStyle = bright ? INK : THREAD;
  ctx.beginPath();
  ctx.arc(x, headSy, bright ? 4.2 : 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawParticles(ctx: CanvasRenderingContext2D, world: World): void {
  if (world.particles.length === 0) return;
  for (const p of world.particles) {
    const a = p.life / p.maxLife;
    ctx.fillStyle = rgba(THREAD, a);
    ctx.fillRect(p.x - 1.2, THREAD_SCREEN_Y - p.y - 1.2, 2.4, 2.4);
  }
}

function drawVignette(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createRadialGradient(
    FIELD_W / 2,
    FIELD_H * 0.55,
    FIELD_W * 0.2,
    FIELD_W / 2,
    FIELD_H * 0.5,
    FIELD_H * 0.72,
  );
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(11,13,16,0.55)");
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

function rgba(hex: string, a: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}
