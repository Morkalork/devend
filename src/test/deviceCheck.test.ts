/**
 * The device check (DEVICE_LAB.md): asked for as "I need to know that it works
 * on phones as old as four years". What it plays, how it judges, how it reads
 * a board back, and the three ways in (Admin, the CI hook, a Test Lab launch).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import {
  DEVICE_CHECK_LEVELS, PLAYABLE_MEDIAN_MS, SLOW_FRAME_MS, frameStats, verdict, type MapCheck,
} from "@/lib/deviceCheck/model";
import { onNextBoardFrame, runBoardFrameHooks } from "@/lib/rendering/boardFrameHook";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("frame statistics", () => {
  it("are zeros for no frames", () => {
    expect(frameStats([])).toEqual({ frames: 0, medianMs: 0, p95Ms: 0, fps: 0, slowShare: 0 });
  });

  it("give the median, the 95th percentile and the share of slow frames", () => {
    const intervals = [...Array(90).fill(16.7), ...Array(10).fill(50)];
    const s = frameStats(intervals);
    expect(s.frames).toBe(100);
    expect(s.medianMs).toBe(16.7);
    expect(s.fps).toBe(59.9);
    expect(s.p95Ms).toBe(50);
    expect(s.slowShare).toBe(0.1);
    expect(SLOW_FRAME_MS).toBeCloseTo(33.3, 1);
  });
});

describe("the verdict", () => {
  const map = (over: Partial<MapCheck> = {}): MapCheck => ({
    level: 1, id: "level-1", loaded: true, frames: frameStats(Array(200).fill(16.7)),
    board: { lit: 160, total: 256 }, fenceTaken: true, tier: "3d medium", renderAvgMs: 4, physicsPeakMs: 2,
    ...over,
  });
  const ok = { bootMs: 3000, menu: { lit: 256, total: 256 }, maps: [map()], errors: [] as string[] };

  it("passes a device that shows everything, takes the fence and plays smoothly", () => {
    expect(verdict(ok)).toEqual({ pass: true, failures: [], warnings: [] });
  });

  it("fails a menu or a board that drew nothing visible: Opera on PowerVR, the reason this reads pixels", () => {
    expect(verdict({ ...ok, menu: { lit: 0, total: 256 } }).failures).toEqual(["the menu drew nothing visible"]);
    expect(verdict({ ...ok, maps: [map({ board: { lit: 0, total: 256 } })] }).failures)
      .toEqual(["level 1: the board drew nothing visible"]);
    // Unreadable is not invisible: it warns.
    expect(verdict({ ...ok, menu: null }).pass).toBe(true);
    expect(verdict({ ...ok, maps: [map({ board: null })] }).warnings).toEqual(["level 1: the board's pixels could not be read"]);
  });

  it("fails a slow boot, a map that never loaded, a fence not taken and any error", () => {
    expect(verdict({ ...ok, bootMs: null }).failures).toEqual(["the menu never finished loading"]);
    expect(verdict({ ...ok, bootMs: 25000 }).failures[0]).toMatch(/took 25s/);
    expect(verdict({ ...ok, maps: [map({ loaded: false })] }).failures).toEqual(["level 1 did not load"]);
    expect(verdict({ ...ok, maps: [map({ fenceTaken: false })] }).failures[0]).toMatch(/fence .* not taken/);
    expect(verdict({ ...ok, errors: ["boom"] }).failures).toEqual(["1 error(s) on the page"]);
  });

  it("fails an unplayable frame rate on a real device, warns on a stuttering one, and only reports it when told to", () => {
    const slow = map({ frames: frameStats(Array(100).fill(PLAYABLE_MEDIAN_MS + 10)) });
    expect(verdict({ ...ok, maps: [slow] }).failures[0]).toMatch(/fps at the median frame/);
    const stutter = map({ frames: frameStats([...Array(70).fill(16.7), ...Array(30).fill(40)]) });
    expect(verdict({ ...ok, maps: [stutter] })).toMatchObject({ pass: true, warnings: ["level 1: 30% of frames under 30 fps"] });
    // The emulated CI tiers: a software GPU, so the rate is reported, never judged.
    expect(verdict({ ...ok, maps: [slow] }, { judgeFrames: false }).pass).toBe(true);
    expect(verdict({ ...ok, maps: [map({ frames: frameStats([]) })] }, { judgeFrames: false }).failures)
      .toEqual(["level 1: no frames were drawn"]);
  });
});

describe("the maps it plays", () => {
  const levels = (yaml.load(read("public/map.yml")) as { levels: Array<Record<string, unknown>> }).levels;

  it("exist, and each plays from its first frame: no launcher waiting for a pull", () => {
    for (const n of DEVICE_CHECK_LEVELS) {
      const level = levels.find(l => l.level === n);
      expect(level, `level ${n}`).toBeDefined();
      expect(JSON.stringify(level).toLowerCase(), `level ${n}`).not.toContain("launcher");
    }
  });
});

describe("reading the board back", () => {
  it("runs each hook once, right after the board's next frame, and survives one that throws", () => {
    const seen: string[] = [];
    onNextBoardFrame(() => seen.push("a"));
    onNextBoardFrame(() => { throw new Error("probe"); });
    onNextBoardFrame(() => seen.push("b"));
    runBoardFrameHooks();
    runBoardFrameHooks();
    expect(seen).toEqual(["a", "b"]);
  });

  it("is called by the game loop straight after it renders", () => {
    const loop = read("src/hooks/useGameLoop.ts");
    expect(loop).toMatch(/callbacks\.render\(\);\s*\/\/[^\n]*\n\s*runBoardFrameHooks\(\);/);
  });

  it("reads the canvas's own framebuffer and puts the renderer's binding back", () => {
    const probes = read("src/lib/deviceCheck/probes.ts");
    expect(probes).toContain("gl.bindFramebuffer(gl.FRAMEBUFFER, null);");
    expect(probes).toContain("gl2.bindFramebuffer(gl2.DRAW_FRAMEBUFFER, drawWas);");
    expect(read("src/components/game/GameCanvas.tsx")).toContain('data-board-canvas=""');
  });
});

describe("the governor's step down", () => {
  // Found by the device check: on any device slow enough for the governor to
  // step down mid-map, that frame threw "reading 'alphaMode'". The resize ran
  // inside the 2D layer's render, destroying textures its sprites already held.
  const src = read("src/lib/rendering/three/ThreeRenderer.ts");
  const step = src.slice(src.indexOf("private stepDownForSlowFrames"), src.indexOf("presentEmpty(): void"));

  it("re-allocates the frame after it, never inside it", () => {
    expect(step).toContain("this.resizeAfterFrame();");
    expect(step).not.toContain("this.sleek.resize(");
    expect(src).toMatch(/queueMicrotask\(\(\) => \{\s*this\.resizeQueued = false;/);
  });

  it("queues one resize however many steps land in a frame", async () => {
    const queued: Array<() => void> = [];
    const spy = vi.spyOn(globalThis, "queueMicrotask").mockImplementation(cb => { queued.push(cb); });
    const { ThreeRenderer } = await import("@/lib/rendering/three/ThreeRenderer");
    const r = new ThreeRenderer() as unknown as {
      pixi: unknown; renderer: unknown; lost: boolean; size: { w: number; h: number };
      sleek: { resize: (w: number, h: number, force?: boolean) => void };
      resizeAfterFrame: () => void;
    };
    const resize = vi.fn();
    r.pixi = {};
    r.renderer = {};
    r.lost = false;
    r.size = { w: 400, h: 800 };
    r.sleek = { resize };
    r.resizeAfterFrame();
    r.resizeAfterFrame();
    expect(queued).toHaveLength(1);
    expect(resize).not.toHaveBeenCalled();
    queued[0]();
    expect(resize).toHaveBeenCalledWith(400, 800, true);
    spy.mockRestore();
  });
});

describe("the ways in", () => {
  it("has an Admin button, which goes back to the menu first so the menu it measures is the player's", () => {
    const admin = read("src/components/admin/AdminScreen.tsx");
    expect(admin).toMatch(/id="admin-device-check"[\s\S]*?onBack\(\);\s*void requestDeviceCheck\('admin'\);/);
  });

  it("has the CI hook and the Test Lab launch installed from main.tsx", () => {
    const main = read("src/main.tsx");
    expect(main).toContain("installDeviceCheckHook();");
    expect(main).toContain("void installTestLoop();");
  });

  it("opens its screen outside admin, because the store build runs it under Test Lab", () => {
    const index = read("src/pages/Index.tsx");
    expect(index).toContain("{deviceCheckRun && navigation.currentScreen === 'deviceCheck' && (");
    expect(index).not.toContain("adminUnlocked && deviceCheckRun");
  });

  it("writes the result back to Test Lab only for a Test Lab launch", () => {
    const loop = read("src/lib/deviceCheck/testLoop.ts");
    expect(loop).toContain('if (run.source === "testLoop") {');
    expect(loop).toContain("if (!Capacitor.isNativePlatform()) {");
  });
});

describe("the device lab's phones", async () => {
  const { pickDevices, deviceFlags } = await import("../../scripts/device-lab-pick.mjs");
  const wishlist = JSON.parse(read("device-lab.json"));
  const phone = (id: string, name: string, versions: string[], form = "PHYSICAL") =>
    ({ id, name, form, formFactor: "PHONE", supportedVersionIds: versions });

  it("are 2022 phones across GPU makers, a PowerVR one among them, within the free plan's five a day", () => {
    expect(wishlist.max).toBeLessThanOrEqual(5);
    expect(wishlist.min).toBeGreaterThanOrEqual(2);
    expect(wishlist.wishes.map((w: { why: string }) => w.why).join(" ")).toMatch(/PowerVR/);
  });

  it("take each wish's first match among physical phones, at the newest Android it has, and each model once", () => {
    const catalogue = [
      phone("a13", "Galaxy A13", ["31", "33"]),
      phone("a33x", "Galaxy A33 5G", ["33"]),
      phone("bluejay", "Pixel 6a", ["32", "34", "33"]),
      phone("bluejay-virtual", "Pixel 6a", ["34"], "VIRTUAL"),
      phone("r0q", "Galaxy S22", ["34"]),
    ];
    const { picked, missed, enough } = pickDevices(catalogue, wishlist);
    expect(picked.map((p: { model: string }) => p.model)).toEqual(["a13", "a33x", "bluejay", "r0q"]);
    expect(picked[2].version).toBe("34");
    expect(missed).toEqual(["budget 2022, PowerVR GE8320"]);
    expect(enough).toBe(true);
    expect(deviceFlags(picked)[0]).toBe("--device=model=a13,version=33,locale=en,orientation=portrait");
  });

  it("say so when the catalogue has too few of them", () => {
    expect(pickDevices([phone("a13", "Galaxy A13", ["33"])], wishlist).enough).toBe(false);
  });
});

describe("the device lab's report", async () => {
  const { resultFromLogcat, summarize } = await import("../../scripts/device-lab-report.mjs");
  const result = {
    pass: true, bootMs: 4200, device: { gpu: "Mali-G52", screen: "360x800", dpr: 2, cores: 8 },
    maps: [{ level: 1, frames: frameStats(Array(100).fill(16.7)), board: { lit: 160, total: 256 }, fenceTaken: true, tier: "3d low" }],
    failures: [], warnings: [], renderer: [], errors: [],
  };

  it("puts the report back together from the log's numbered pieces, in any order", () => {
    const json = JSON.stringify(result);
    const half = Math.floor(json.length / 2);
    const log = [
      `10-26 I TestLoop: DEVICE_CHECK_RESULT 2/2 ${json.slice(half)}`,
      "10-26 I other: noise",
      `10-26 I TestLoop: DEVICE_CHECK_RESULT 1/2 ${json.slice(0, half)}`,
    ].join("\n");
    expect(resultFromLogcat(log)).toEqual(result);
    expect(resultFromLogcat(`DEVICE_CHECK_RESULT 1/2 ${json.slice(0, half)}`)).toBeNull();
  });

  it("fails the run for a failing phone and for a phone with no report at all", () => {
    expect(summarize([{ device: "a13-33", result, from: "results file" }]).pass).toBe(true);
    expect(summarize([{ device: "a13-33", result: { ...result, pass: false, failures: ["level 1: the board drew nothing visible"] }, from: "logcat" }]).pass).toBe(false);
    const none = summarize([{ device: "hawao-31", result: null, from: "none" }]);
    expect(none.pass).toBe(false);
    expect(none.markdown).toContain("No report: the check did not finish");
    expect(summarize([]).pass).toBe(false);
  });
});

describe("the emulated tiers", async () => {
  it("cover 2022 phones from flagship to budget, and only report the frame rate", () => {
    const script = read("scripts/device-check-emulated.mjs");
    for (const tier of ["flagship-2022", "mid-2022", "budget-2022"]) {
      expect(script).toContain(`"${tier}": {`);
      expect(read(".github/workflows/ci.yml")).toContain(tier);
    }
    expect(script).toContain("window.__devendStartDeviceCheck({ judgeFrames: false })");
    expect(script).toContain('cdp.send("Emulation.setCPUThrottlingRate"');
  });
});
