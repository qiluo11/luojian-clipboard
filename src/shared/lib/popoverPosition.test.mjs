import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { popoverPosition } from "./popoverPosition.ts";
describe("viewport menu flip and clamp", () => {
  for (const [name, x, y, expected] of [
    ["right/down", 20, 20, { x: 20, y: 20 }],
    ["left/down", 340, 20, { x: 156, y: 20 }],
    ["right/up", 20, 370, { x: 20, y: 230 }],
    ["left/up", 340, 370, { x: 156, y: 230 }],
    ["negative coordinates", -10, -5, { x: 8, y: 8 }],
    ["outside viewport", 500, 500, { x: 160, y: 232 }],
    ["exact right margin", 160, 20, { x: 160, y: 20 }],
    ["one pixel past fit", 161, 20, { x: 8, y: 20 }],
  ])
    it(name, () =>
      assert.deepEqual(popoverPosition(x, y, 184, 140, 352, 380), expected),
    );
  it("nearly viewport-sized menu remains bounded", () =>
    assert.deepEqual(popoverPosition(344, 372, 336, 364, 352, 380), {
      x: 8,
      y: 8,
    }));
  it("small viewport", () =>
    assert.deepEqual(popoverPosition(240, 280, 234, 274, 250, 290), {
      x: 8,
      y: 8,
    }));
});
