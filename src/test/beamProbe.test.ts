/**
 * The probe has to be right, or it sends the next investigation the wrong way.
 *
 * It exists because a reported beam survived two correct fixes, a nine-layer
 * headless sweep and several minutes of local play. That makes it the only
 * instrument pointed at the session where the bug actually happens, so a false
 * negative wastes the one chance to catch it and a false positive puts a red
 * banner over someone's game for nothing.
 */
import { describe, it, expect } from "vitest";
import { Container, Graphics } from "pixi.js";
import { BeamProbe, showBeamReadout } from "@/lib/rendering/sleek/beamProbe";

const LONG = 1400;

/** A subpath that was never opened: Pixi joins it to the origin. */
function withBeam(): Graphics {
  const g = new Graphics();
  g.moveTo(0, 0).lineTo(LONG, 0).stroke({ width: 2, color: 0xffffff });
  return g;
}

/**
 * Everything a layer legitimately draws, including the cases that made the
 * first live run cry wolf.
 *
 * The board grid line and the board edge are BOTH longer than any threshold
 * low enough to catch a beam, because the canvas is in device pixels. They are
 * here so that a future switch back to a length test fails immediately.
 */
function withOrdinaryMarks(): Graphics {
  const g = new Graphics();
  g.circle(100, 100, 12).stroke({ width: 2, color: 0xffffff });          // a ring
  g.moveTo(1290, 120).lineTo(1290, 1379).stroke({ width: 2, color: 0x244434 }); // grid line
  g.moveTo(1312, 142).lineTo(2527, 142).stroke({ width: 6, color: 0x5c8172 });  // board edge
  g.moveTo(50, 50).lineTo(50, 850).stroke({ width: 6, color: 0x00ff88 });       // a fence
  return g;
}

describe("the beam probe", () => {
  it("names the layer holding a line across the board", () => {
    const probe = new BeamProbe();
    const hits = probe.run([["fx", withBeam()]], 0);
    expect(hits).not.toBeNull();
    expect(hits![0].layer).toBe("fx");
    expect(hits![0].length).toBeGreaterThanOrEqual(LONG);
    expect(hits![0].from).toEqual({ x: 0, y: 0 });
    expect(hits![0].to).toEqual({ x: LONG, y: 0 });
  });

  it("stays silent for rings, grid lines, board edges and fences", () => {
    // The false-positive case. The first live run flagged all three of the
    // long marks above, because on a 2x display the board is ~1250 device
    // pixels and honest geometry is longer than any usable length bound.
    const probe = new BeamProbe();
    expect(probe.run([["walls", withOrdinaryMarks()]], 0)).toBeNull();
  });

  it("finds a beam nested inside a layer's children", () => {
    // Layers hold their Graphics in sub-containers, so a probe that only looked
    // at the root would report nothing while the beam was on screen.
    const root = new Container();
    const mid = new Container();
    mid.addChild(withBeam());
    root.addChild(mid);
    const hits = new BeamProbe().run([["balls", root]], 0);
    expect(hits).not.toBeNull();
    expect(hits![0].layer).toMatch(/^balls\[/);
  });

  it("throttles, and reports a beam once rather than every frame", () => {
    const probe = new BeamProbe();
    const roots: Array<[string, Container | Graphics]> = [["fx", withBeam()]];
    expect(probe.run(roots, 0)).not.toBeNull();
    // Same frame budget: throttled.
    expect(probe.run(roots, 100)).toBeNull();
    // Past the throttle, but the same beam: already said.
    expect(probe.run(roots, 5000)).toBeNull();
  });

  it("reports again after the beam goes away and comes back", () => {
    // A beam that flickers is the most informative kind, and a probe that
    // latched on the first sighting would hide exactly that.
    const probe = new BeamProbe();
    const beam: Array<[string, Container | Graphics]> = [["fx", withBeam()]];
    const clean: Array<[string, Container | Graphics]> = [["fx", withOrdinaryMarks()]];
    expect(probe.run(beam, 0)).not.toBeNull();
    expect(probe.run(clean, 1000)).toBeNull();
    expect(probe.run(beam, 2000)).not.toBeNull();
  });

  it("puts the answer on screen, where a phone can show it", () => {
    // The reporter is on a phone. A console-only probe would be readable by
    // nobody who can reproduce the bug.
    showBeamReadout(["[beam] fx  1400px  (0,0) -> (1400,0)"]);
    const el = document.getElementById("devend-beam-readout")!;
    expect(el).toBeTruthy();
    expect(el.textContent).toContain("fx");
    expect(el.getAttribute("style")).toContain("position:fixed");
    // Must never eat a tap: the player has to keep playing to reproduce.
    expect(el.getAttribute("style")).toContain("pointer-events:none");

    // Updating replaces rather than stacking, or a long session buries the
    // board under banners.
    showBeamReadout(["[beam] walls  999px  (1,2) -> (3,4)"]);
    expect(document.querySelectorAll("#devend-beam-readout").length).toBe(1);
    expect(document.getElementById("devend-beam-readout")!.textContent).toContain("walls");
  });
});
