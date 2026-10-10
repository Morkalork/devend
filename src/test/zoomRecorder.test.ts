/**
 * Stage 0 of CANVAS_UI_PLAN.md: the zoom log has to say what happened and
 * where the touch began, or the next report is as unreadable as the last eight.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ZOOM_LOG_CAP, clearZoomLog, describeTarget, getZoomLog, installZoomRecorder, recordZoomEvent, zoomLogText,
} from "@/lib/zoomRecorder";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** jsdom has no PointerEvent; the recorder only reads the type and target. */
function pointer(type: string): Event {
  const e = new Event(type, { bubbles: true });
  Object.defineProperty(e, "pointerType", { value: "touch" });
  return e;
}

describe("the zoom log", () => {
  beforeEach(() => clearZoomLog());

  it("keeps the newest entries up to its cap", () => {
    for (let i = 0; i < ZOOM_LOG_CAP + 10; i++) recordZoomEvent("board", `b${i}`);
    const log = getZoomLog();
    expect(log).toHaveLength(ZOOM_LOG_CAP);
    expect(log.at(-1)!.detail).toBe(`b${ZOOM_LOG_CAP + 9}`);
  });

  it("tells a canvas from the DOM around it", () => {
    expect(describeTarget(document.createElement("canvas"))).toBe("canvas");
    const div = document.createElement("div");
    div.className = "top-bar flex gap-2";
    expect(describeTarget(div)).toBe("div.top-bar.flex");
  });

  it("records where a touch began and how many fingers are down", () => {
    const stop = installZoomRecorder(window);
    const div = document.createElement("div");
    div.id = "chrome";
    document.body.appendChild(div);
    div.dispatchEvent(pointer("pointerdown"));
    recordZoomEvent("board", "relayout");
    const e = getZoomLog().at(-1)!;
    expect(e.fingers).toBe(1);
    expect(e.startedOn).toBe("div#chrome");
    window.dispatchEvent(pointer("pointerup"));
    stop();
    div.remove();
  });

  it("logs a window resize once per real change", () => {
    const stop = installZoomRecorder(window);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: window.innerHeight + 40 });
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    expect(getZoomLog().filter(e => e.kind === "resize")).toHaveLength(1);
    stop();
  });

  it("is installed at startup, fed by the board re-layout, and shown in Admin", () => {
    expect(read("src/main.tsx")).toMatch(/installZoomRecorder\(window\)/);
    expect(read("src/components/game/GameCanvas.tsx")).toMatch(/recordZoomEvent\("board"/);
    expect(read("src/components/admin/AdminScreen.tsx")).toMatch(/<ZoomRecorderCard/);
    expect(zoomLogText([])).toMatch(/no zoom events/);
  });
});
