/**
 * The startup splash holds until the first screen has finished loading.
 *
 * Reported as a flicker: tap past the splash and the menu was still arriving,
 * buttons popping in as the stats, certificates and music list loaded, the
 * background redrawing once its config came. Now the splash says "Loading..."
 * and takes no tap until every piece has reported (startupReadiness.ts) and
 * stayed ready long enough for the menu's own entrance to finish under it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import {
  STARTUP_PARTS, isStartupReady, markStartupReady, pendingStartupParts, resetStartupReadiness,
} from "@/lib/startupReadiness";
import { MAX_WAIT_MS, SETTLE_MS, splashPhase } from "@/ui/screens/tapToStartModel";
import { useScreenNavigation } from "@/hooks/useScreenNavigation";
import { useGameSession } from "@/hooks/useGameSession";

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");
const PUBLIC = path.resolve(__dirname, "../../public");

describe("what the splash shows", () => {
  const base = { settled: false, tapped: false, audioUnlocked: false, awaitingGesture: false, audioDecisionTimedOut: false };

  it("says loading, and takes no tap, until the first screen has settled", () => {
    expect(splashPhase(base)).toBe("loading");
    // Even where the browser is already waiting for the tap.
    expect(splashPhase({ ...base, awaitingGesture: true })).toBe("loading");
    expect(splashPhase({ ...base, audioUnlocked: true })).toBe("loading");
  });

  it("asks for the tap once settled, where audio needs one", () => {
    expect(splashPhase({ ...base, settled: true, awaitingGesture: true })).toBe("tap");
    expect(splashPhase({ ...base, settled: true, awaitingGesture: true, tapped: true })).toBe("gone");
  });

  it("lifts on its own once settled where audio needs no tap", () => {
    expect(splashPhase({ ...base, settled: true, audioUnlocked: true })).toBe("gone");
    // Undecided: it waits for the decision, then counts silence as allowed.
    expect(splashPhase({ ...base, settled: true })).toBe("loading");
    expect(splashPhase({ ...base, settled: true, audioDecisionTimedOut: true })).toBe("gone");
  });

  it("lets the menu's entrance finish under it, and never traps anyone", () => {
    expect(SETTLE_MS).toBeGreaterThanOrEqual(450); // WelcomeScreen's staggered fade-in
    expect(MAX_WAIT_MS).toBeLessThanOrEqual(15000);
  });
});

describe("the readiness store", () => {
  beforeEach(() => resetStartupReadiness());

  it("is ready only when every part has reported", () => {
    expect(isStartupReady()).toBe(false);
    expect(pendingStartupParts()).toEqual([...STARTUP_PARTS]);
    markStartupReady("menu");
    markStartupReady("music");
    expect(isStartupReady()).toBe(false);
    expect(pendingStartupParts()).toEqual(["background"]);
    markStartupReady("background");
    markStartupReady("background"); // idempotent
    expect(isStartupReady()).toBe(true);
  });
});

describe("the wiring", () => {
  it("has each part report from the place that knows", () => {
    const index = read("src/pages/Index.tsx");
    expect(index).toContain("markStartupReady('music');");
    expect(index).toContain("markStartupReady('menu');");
    expect(index).toContain("if (session.menuDataReady) {");
    // Loaded or failed, the music list counts as decided.
    expect(index).toMatch(/\}\)\.finally\(\(\) => \{\s*if \(!cancelled\) setMusicSettled\(true\);/);
    const crt = read("src/components/game/CRTBackground.tsx");
    expect(crt).toContain("requestAnimationFrame(() => markStartupReady('background'))");
  });

  it("is opaque from its first frame, and swallows a tap while loading", () => {
    const gate = read("src/ui/screens/TapToStartGate.tsx");
    const body = gate.slice(gate.indexOf("export function TapToStartGate"));
    expect(body).not.toMatch(/<Appear layout=\{\{ width: screen\.width, height: screen\.height \}\}>/);
    expect(body).toContain('if (phase !== "tap" || preview) {');
  });
});

describe("the session reports the menu ready by itself", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const file = String(url).split("?")[0].replace(/^\//, "");
      const full = path.join(PUBLIC, file);
      if (!fs.existsSync(full)) return { ok: false, status: 404, text: async () => "" } as Response;
      return { ok: true, status: 200, text: async () => fs.readFileSync(full, "utf8") } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("once the stats, unlocks and certificates have loaded", async () => {
    const { result } = renderHook(() => {
      const nav = useScreenNavigation();
      return useGameSession(nav);
    });
    await waitFor(() => expect(result.current.menuDataReady).toBe(true));
  });
});

describe("the boot splash covers everything before the canvas splash", () => {
  // Reported: "I still see the code background briefly before the splash".
  // The canvas splash can only draw once the scripts, fonts and Pixi are up;
  // until then the DOM code background was the first thing on screen.
  const html = read("index.html");

  it("is in the page itself, before the app's root, so it paints with the first frame", () => {
    expect(html.indexOf('<div id="boot-splash"')).toBeGreaterThan(-1);
    expect(html.indexOf('<div id="boot-splash"')).toBeLessThan(html.indexOf('<div id="root">'));
    expect(html).toMatch(/#boot-splash \{[\s\S]*?position: fixed;[\s\S]*?background: #0d1012;/);
  });

  it("matches the canvas splash's surface, so the hand-over is invisible", async () => {
    const { ROLE } = await import("@/ui/theme");
    expect(`#${ROLE.surface.toString(16).padStart(6, "0")}`).toBe("#0d1012");
  });

  it("never shows a stand-in font, and has a backstop if the canvas never comes", () => {
    expect(html).toContain("font-display: block;");
    expect(html).toMatch(/setTimeout\(function \(\) \{\s*var el = document\.getElementById\('boot-splash'\);/);
  });

  it("is faded out by the canvas splash once that has been painted, and only then", async () => {
    const gate = read("src/ui/screens/TapToStartGate.tsx");
    expect(gate).toContain("second = requestAnimationFrame(() => dismissBootSplash());");
    const { dismissBootSplash } = await import("@/lib/bootSplash");
    document.body.innerHTML = '<div id="boot-splash"></div>';
    vi.useFakeTimers();
    dismissBootSplash();
    const el = document.getElementById("boot-splash")!;
    expect(el.style.opacity).toBe("0");
    vi.advanceTimersByTime(400);
    expect(document.getElementById("boot-splash")).toBeNull();
    vi.useRealTimers();
    dismissBootSplash(); // already gone: a no-op
  });
});
