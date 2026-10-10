/**
 * The canvas PushYourLuckOverlay's numbers and placement
 * (src/ui/game/PushYourLuckOverlayModel.ts).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pushChunkPercent, pushLuckBox } from "@/ui/game/PushYourLuckOverlayModel";

describe("the push-your-luck prompt", () => {
  it("states the chunk worth +1 OT: a quarter of what remains, rounded", () => {
    expect(pushChunkPercent(40)).toBe("10");
    expect(pushChunkPercent(30)).toBe("8");
    expect(pushChunkPercent(18)).toBe("5");
  });

  it("floats above the controls on a phone and centres from 640px", () => {
    expect(pushLuckBox({ width: 390, height: 844 })).toEqual({ left: 16, width: 358, bottom: 96 });
    expect(pushLuckBox({ width: 1000, height: 800 })).toEqual({ left: 308, width: 384, top: 260 });
  });

  it("answers once: both buttons go dead after either is pressed", () => {
    const src = readFileSync(resolve(process.cwd(), "src/ui/game/PushYourLuckOverlay.tsx"), "utf8");
    expect(src.match(/disabled=\{chosen\}/g)?.length).toBe(2);
    expect(src).toContain("setChosen(true); onBank();");
    expect(src).toContain("setChosen(true); onPush();");
  });
});
