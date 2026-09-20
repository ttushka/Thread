import { describe, expect, it } from "vitest";
import { EDGE_RAIL_ART, PLAYFIELD_ART, SCORE_TICK_ART, WALL_ART } from "../render/draw.ts";
import { BEAT_GLOW_BLUR_MAX } from "../variant.ts";
import {
  GATE_LIP_THICKNESS,
  NEAR_MISS_BAND,
  NICK_BAND,
  SCORE_TICK_EDGE_MS,
  SCORE_TICK_FILAMENT_MS,
  SCORE_TICK_HUD_MS,
} from "../world/constants.ts";

describe("WALL-MOVER-POLISH-BRIEF-v1 tokens", () => {
  it("locks corridor, lip, and mover palette / stroke / depth", () => {
    expect(WALL_ART.obstacle).toBe("#3D4450");
    expect(WALL_ART.obstacleEdge).toBe("#5A6270");
    expect(WALL_ART.pinchLip).toBe("#161A22");
    expect(WALL_ART.pinchLipEdge).toBe("#B8C0CC");
    expect(WALL_ART.pinchLipStroke).toBeGreaterThanOrEqual(2.5);
    expect(WALL_ART.pinchLipStroke).toBeLessThanOrEqual(3);
    expect(WALL_ART.mover).toBe("#242A34");
    expect(WALL_ART.moverEdge).toBe("#A8B0BC");
    expect(WALL_ART.moverStroke).toBe(2);
    expect(WALL_ART.innerShade).toBeGreaterThan(0);
    expect(WALL_ART.innerShade).toBeLessThanOrEqual(0.08);
    expect(WALL_ART.contactShadowBlur).toBeGreaterThanOrEqual(4);
    expect(WALL_ART.contactShadowBlur).toBeLessThanOrEqual(8);
    expect(WALL_ART.contactShadowAlpha).toBeGreaterThan(0);
    expect(WALL_ART.contactShadowAlpha).toBeLessThanOrEqual(0.2);
  });

  it("does not retune lip collision thickness", () => {
    expect(GATE_LIP_THICKNESS).toBeGreaterThanOrEqual(10);
    expect(GATE_LIP_THICKNESS).toBeLessThanOrEqual(14);
    expect(GATE_LIP_THICKNESS).toBe(12);
  });
});

describe("ART-SKIM-TICK-JUICE-BUMP-v1 tokens", () => {
  it("locks award-tick windows and existing teal / pinch-lip-edge family", () => {
    expect(SCORE_TICK_FILAMENT_MS).toBeGreaterThanOrEqual(140);
    expect(SCORE_TICK_FILAMENT_MS).toBeLessThanOrEqual(180);
    expect(SCORE_TICK_EDGE_MS).toBeGreaterThanOrEqual(100);
    expect(SCORE_TICK_EDGE_MS).toBeLessThanOrEqual(140);
    expect(SCORE_TICK_HUD_MS).toBe(120);
    expect(SCORE_TICK_ART.filament).toBe("#5EEAD4");
    expect(SCORE_TICK_ART.edge).toBe("#B8C0CC");
    expect(SCORE_TICK_ART.edge).toBe(WALL_ART.pinchLipEdge);
    expect(SCORE_TICK_ART.edge).not.toBe(SCORE_TICK_ART.filament);
  });
});

describe("IDENTITY-EDGE-RAIL-v1 tokens", () => {
  it("locks a teal rail on the inner edge, thicker on bloom, within Art caps", () => {
    expect(EDGE_RAIL_ART.color).toBe("#5EEAD4");
    expect(EDGE_RAIL_ART.color).toBe(SCORE_TICK_ART.filament);
    expect(EDGE_RAIL_ART.idleWidth).toBeGreaterThanOrEqual(1.2);
    expect(EDGE_RAIL_ART.idleWidth).toBeLessThan(EDGE_RAIL_ART.bloomWidth);
    expect(EDGE_RAIL_ART.bloomWidth).toBeLessThanOrEqual(EDGE_RAIL_ART.scoreWidth);
    expect(EDGE_RAIL_ART.scoreWidth).toBeLessThanOrEqual(4.4);
    expect(EDGE_RAIL_ART.idleAlpha).toBeGreaterThan(0.2);
    expect(EDGE_RAIL_ART.idleAlpha).toBeLessThan(EDGE_RAIL_ART.bloomAlpha);
    expect(EDGE_RAIL_ART.bloomAlpha).toBeGreaterThanOrEqual(0.85);
    expect(EDGE_RAIL_ART.bloomBlur).toBeLessThanOrEqual(BEAT_GLOW_BLUR_MAX);
    expect(EDGE_RAIL_ART.scoreBlur).toBeLessThanOrEqual(BEAT_GLOW_BLUR_MAX);
    expect(EDGE_RAIL_ART.contactBand).toBeGreaterThanOrEqual(48);
    expect(EDGE_RAIL_ART.contactBand).toBeGreaterThan(NEAR_MISS_BAND + NICK_BAND);
    expect(PLAYFIELD_ART.centerDimAlpha).toBeGreaterThan(0);
    expect(PLAYFIELD_ART.centerDimAlpha).toBeLessThanOrEqual(0.4);
    expect(PLAYFIELD_ART.panel).not.toBe("#12151A");
  });
});
