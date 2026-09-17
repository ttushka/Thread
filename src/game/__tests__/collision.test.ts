import { describe, expect, it } from "vitest";
import { classifyGapHit } from "../world/collision.ts";

describe("collision bands", () => {
  it("nicks on a graze and dies on a full intersect", () => {
    expect(classifyGapHit(180, 100, 260)).toBe("none");
    expect(classifyGapHit(108, 100, 260)).toBe("nick");
    expect(classifyGapHit(252, 100, 260)).toBe("nick");
    expect(classifyGapHit(90, 100, 260)).toBe("death");
    expect(classifyGapHit(270, 100, 260)).toBe("death");
  });
});
