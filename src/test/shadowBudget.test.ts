/**
 * The shadow budget (lights3d.ts scheduleShadows, quality.ts).
 *
 * Every shadowed point light used to redraw its cube map every frame, six
 * scene renders each, which with the monitor came to 13 scene renders a frame
 * on the tier most phones start on. Now each tier redraws a set number per
 * frame in turn, and only a light that has jumped somewhere else is redrawn
 * out of turn, because a map drawn from another place casts the wrong way.
 */
import { describe, it, expect } from "vitest";
import { Group, Scene } from "three";
import { Lights3D, SHADOW_JUMP, type WantedLight } from "@/lib/rendering/three/lights3d";
import { QUALITY_PRESETS } from "@/lib/rendering/three/quality";

const ball = (x: number, y: number): WantedLight => ({ x, y, height: 10, reach: 120, intensity: 1, color: 0xffffff, rank: 2 });

function rig(tier: keyof typeof QUALITY_PRESETS) {
  const lights = new Lights3D(new Scene(), new Group(), QUALITY_PRESETS[tier]);
  const shadowed = (lights as unknown as { shadowed: { shadow: { needsUpdate: boolean } }[] }).shadowed;
  // Three clears the flag once it has drawn the map; stand in for that.
  const drawn = () => {
    const out = shadowed.map(l => l.shadow.needsUpdate);
    for (const l of shadowed) l.shadow.needsUpdate = false;
    const key = lights.monitor.shadow.needsUpdate;
    lights.monitor.shadow.needsUpdate = false;
    return { points: out, key };
  };
  return { lights, drawn };
}

describe("the shadow budget", () => {
  it("medium redraws one cube map a frame, the two lights in turn", () => {
    const { lights, drawn } = rig("medium");
    const wanted = [ball(100, 100), ball(600, 600)];
    lights.sync(wanted, 1, 0);
    drawn(); // the first frame draws both: neither had a map from here yet
    const seen: boolean[][] = [];
    for (let f = 0; f < 4; f++) {
      lights.sync(wanted, 1, 0);
      seen.push(drawn().points);
    }
    for (const frame of seen) expect(frame.filter(Boolean)).toHaveLength(1);
    expect(seen.map(f => f.indexOf(true))).toEqual([0, 1, 0, 1]);
  });

  it("redraws a light at once when it jumps to another ball, whatever the budget", () => {
    const { lights, drawn } = rig("medium");
    lights.sync([ball(100, 100), ball(600, 600)], 1, 0);
    drawn();
    lights.sync([ball(100, 100), ball(600, 600)], 1, 0);
    drawn();
    // Light 1 handed to a ball far away, light 0 barely moved.
    lights.sync([ball(104, 100), ball(600 - SHADOW_JUMP * 3, 600)], 1, 0);
    expect(drawn().points[1]).toBe(true);
  });

  it("an unlit light is never redrawn", () => {
    const { lights, drawn } = rig("medium");
    lights.sync([ball(100, 100)], 1, 0);
    drawn();
    for (let f = 0; f < 3; f++) {
      lights.sync([ball(100, 100)], 1, 0);
      expect(drawn().points[1]).toBe(false);
    }
  });

  it("the monitor's shadow is redrawn every other frame on medium, and not while the lamp has the board", () => {
    const { lights, drawn } = rig("medium");
    lights.sync([], 1, 0);
    drawn(); // the map made at construction, so it exists before the first draw
    const keys = [];
    for (let f = 0; f < 4; f++) { lights.sync([], 1, 0); keys.push(drawn().key); }
    expect(keys.filter(Boolean)).toHaveLength(2);
    for (let f = 0; f < 4; f++) { lights.sync([], 1, 1); expect(drawn().key).toBe(false); }
  });

  it("is never left to three's per-frame redraw", () => {
    const { lights } = rig("high");
    lights.sync([ball(1, 1), ball(200, 200), ball(400, 400), ball(700, 700)], 1, 0);
    const shadowed = (lights as unknown as { shadowed: { shadow: { autoUpdate: boolean } }[] }).shadowed;
    expect(shadowed.every(l => l.shadow.autoUpdate === false)).toBe(true);
    expect(lights.monitor.shadow.autoUpdate).toBe(false);
  });
});
