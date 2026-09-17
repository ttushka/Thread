import { describe, expect, it } from "vitest";
import { WALL_ART } from "../render/draw.ts";
import { GATE_LIP_THICKNESS } from "../world/constants.ts";

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
