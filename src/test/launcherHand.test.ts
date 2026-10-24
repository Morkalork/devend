/**
 * The launcher hand (lib/launcherHand.ts, LaunchOverlay `hint`): a run's
 * first launcher plays the pull-and-release hand over the band, once per run.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setRunSeedText } from "@/lib/runRng";
import { setLauncherHandAlwaysEnabled } from "@/lib/devFlags";
import { LAUNCHER_HAND_KEY, launcherHandSeen, markLauncherHandSeen, resetLauncherHandSeen } from "@/lib/launcherHand";
import { launchGeometry, launchHintGesture } from "@/ui/game/launchModel";
import { LAUNCH_FULL_PULL } from "@/lib/launcher";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("once per run", () => {
  beforeEach(() => {
    localStorage.clear();
    resetLauncherHandSeen();
    setLauncherHandAlwaysEnabled(false);
    setRunSeedText("run-a");
  });
  afterEach(() => {
    setRunSeedText(null);
    setLauncherHandAlwaysEnabled(false);
  });

  it("shows on a run's first launcher and not again in that run", () => {
    expect(launcherHandSeen()).toBe(false);
    markLauncherHandSeen();
    expect(launcherHandSeen()).toBe(true);
    // A reload mid-run keeps the seed: the stored run is what is read.
    expect(localStorage.getItem(LAUNCHER_HAND_KEY)).toBe("run-a");
  });

  it("comes back on a new game", () => {
    markLauncherHandSeen();
    setRunSeedText("run-b");
    expect(launcherHandSeen()).toBe(false);
  });

  it("comes back when the tutorials are re-enabled", () => {
    markLauncherHandSeen();
    resetLauncherHandSeen();
    expect(launcherHandSeen()).toBe(false);
  });

  it("is held on by the Admin switch", () => {
    markLauncherHandSeen();
    setLauncherHandAlwaysEnabled(true);
    expect(launcherHandSeen()).toBe(false);
  });

  it("is reset with the other tutorials", () => {
    expect(read("src/hooks/useTutorialManager.ts")).toContain("resetLauncherHandSeen()");
  });
});

describe("the gesture", () => {
  const box = { canvasWidth: 400, canvasHeight: 400, canvasOffsetTop: 0, canvasOffsetLeft: 0 };
  const inner = { x: 400, y: 600, width: 100, height: 240 };

  it("starts on the band's grip and pulls back down the barrel, away from the muzzle", () => {
    const geo = launchGeometry({ ...box, ballPosition: { x: 450, y: 620 }, inner, facing: "up", aim: null });
    const g = launchHintGesture(box, geo, "up");
    expect(g.fromX).toBeCloseTo(geo.bandMid.x);
    expect(g.fromY).toBeCloseTo(geo.bandMid.y);
    // Facing up, the muzzle is at the top: the pull goes DOWN the screen.
    expect(g.toY).toBeGreaterThan(g.fromY);
    expect(g.toX).toBeCloseTo(g.fromX);
    // The band's own full-pull travel, at the board's scale (400 px for 900 units).
    expect(g.toY - g.fromY).toBeCloseTo(LAUNCH_FULL_PULL * (400 / 900) * 0.5);
  });

  it("is wired from the canvas and shown in the gallery", () => {
    const canvas = read("src/components/game/GameCanvas.tsx");
    expect(canvas).toContain("hint={!launcherHandSeen()}");
    expect(canvas).toContain("onHintDone={markLauncherHandSeen}");
    expect(read("src/ui/dev/gallery/board.tsx")).toContain('id: "LaunchOverlay-hint"');
  });
});
