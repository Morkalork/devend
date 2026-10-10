/**
 * The 3D board falls back to 2D silently, so whether it started on a device
 * has to be recorded somewhere a tester can read it (rendererDiag.ts, shown in
 * Admin's RendererDiagCard).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  clearRendererDiag, diagText, getRendererDiag, recordRendererStart, recordShaderError,
} from "@/lib/rendering/rendererDiag";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the 3D start record", () => {
  beforeEach(() => clearRendererDiag());

  it("records a failed start with its error, and a later good one replaces it", () => {
    recordRendererStart("failed", new TypeError("no context"), "abc1234");
    const d = getRendererDiag()!;
    expect(d.outcome).toBe("failed");
    expect(d.message).toBe("TypeError: no context");
    expect(d.build).toBe("abc1234");
    recordRendererStart("ok");
    expect(getRendererDiag()!.outcome).toBe("ok");
    expect(getRendererDiag()!.message).toBeUndefined();
  });

  it("keeps a few shader errors, not an unbounded log", () => {
    recordRendererStart("ok");
    for (let i = 0; i < 10; i++) recordShaderError(`err ${i}`);
    expect(getRendererDiag()!.shaderErrors).toHaveLength(4);
  });

  it("writes a report a person can paste", () => {
    recordRendererStart("failed", new Error("boom"));
    const text = diagText("three", getRendererDiag(), null);
    expect(text).toMatch(/renderer setting: three/);
    expect(text).toMatch(/last 3D start: failed/);
    expect(text).toMatch(/Error: boom/);
  });

  it("is recorded on both outcomes and shown in Admin", () => {
    const canvas = read("src/components/game/GameCanvas.tsx");
    expect(canvas).toMatch(/recordRendererStart\("failed"/);
    expect(canvas).toMatch(/recordRendererStart\("ok"/);
    expect(read("src/components/admin/AdminScreen.tsx")).toMatch(/<RendererDiagCard/);
    expect(read("src/lib/rendering/three/ThreeRenderer.ts")).toMatch(/onShaderError/);
  });
});
