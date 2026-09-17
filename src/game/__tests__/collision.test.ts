import { describe, expect, it } from "vitest";
import type { ObstacleSpec } from "../../types.ts";
import { classifyGapHit, hitObstacle } from "../world/collision.ts";
import { GATE_LIP_THICKNESS } from "../world/constants.ts";

describe("collision bands", () => {
  it("nicks on a graze and dies on a full intersect", () => {
    expect(classifyGapHit(180, 100, 260)).toBe("none");
    expect(classifyGapHit(108, 100, 260)).toBe("nick");
    expect(classifyGapHit(252, 100, 260)).toBe("nick");
    expect(classifyGapHit(118, 100, 260)).toBe("nearMiss");
    expect(classifyGapHit(242, 100, 260)).toBe("nearMiss");
    expect(classifyGapHit(90, 100, 260)).toBe("death");
    expect(classifyGapHit(270, 100, 260)).toBe("death");
  });
});

describe("gate lip contact", () => {
  const gate: ObstacleSpec = {
    id: 1,
    kind: "gate",
    y: 800,
    left: 100,
    right: 260,
    thickness: GATE_LIP_THICKNESS,
    baseCenter: 180,
    gapWidth: 160,
    amplitude: 0,
    period: 1,
    phase: 0,
  };
  const gap = { left: gate.left, right: gate.right };

  it("uses the same nick/death bands as walls while the thread is on the lip y-band", () => {
    expect(hitObstacle(180, 800, gate, gap)).toBe(classifyGapHit(180, 100, 260));
    expect(hitObstacle(108, 800, gate, gap)).toBe("nick");
    expect(hitObstacle(90, 800, gate, gap)).toBe("death");
    expect(hitObstacle(270, 800, gate, gap)).toBe("death");
  });

  it("does not collide outside the lip thickness", () => {
    const half = GATE_LIP_THICKNESS / 2;
    expect(hitObstacle(90, 800 - half - 0.5, gate, gap)).toBe("none");
    expect(hitObstacle(90, 800 + half + 0.5, gate, gap)).toBe("none");
  });
});
