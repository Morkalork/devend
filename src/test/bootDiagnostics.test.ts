/**
 * The on-device report (lib/bootDiagnostics.ts), for a phone where the game
 * does not show and there is no console: reported as "after Tap to start, only
 * the code background", in a browser this sandbox cannot run.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { diagnosticsText, installBootDiagnostics, showDiagnostics } from "@/lib/bootDiagnostics";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the report", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.__devendBoot = { start: performance.now(), errors: ["error: boom @ chunk.js:1:2"] };
  });

  it("says what a console would: errors, the interface, the layers, the browser", () => {
    const text = diagnosticsText();
    expect(text).toContain("browser: ");
    expect(text).toContain("interface: drawn ");
    expect(text).toContain("layers: ");
    expect(text).toContain("startup still waiting on: ");
    expect(text).toContain("errors (1):");
    expect(text).toContain("error: boom @ chunk.js:1:2");
  });

  it("shows itself as plain DOM, over everything, with Copy and Close", () => {
    showDiagnostics();
    const overlay = document.getElementById("devend-diagnostics")!;
    expect(overlay).not.toBeNull();
    expect(overlay.querySelector("pre")!.textContent).toContain("errors (1):");
    const buttons = [...overlay.querySelectorAll("button")].map(b => b.textContent);
    expect(buttons).toEqual(["Copy", "Close"]);
    overlay.querySelectorAll("button")[1].dispatchEvent(new MouseEvent("click"));
    expect(document.getElementById("devend-diagnostics")).toBeNull();
  });

  it("keeps console errors too, and is reachable from the page", () => {
    installBootDiagnostics();
    console.error(new Error("caught but broken"));
    expect(window.__devendBoot!.errors.some(e => e.includes("Error: caught but broken"))).toBe(true);
    expect(window.__devendDiag).toBe(showDiagnostics);
  });
});

describe("the wiring", () => {
  it("collects errors from the page's first moment, before the game's scripts", () => {
    const html = read("index.html");
    const early = html.indexOf("var rec = window.__devendBoot");
    expect(early).toBeGreaterThan(-1);
    expect(early).toBeLessThan(html.indexOf('src="/src/main.tsx"'));
    expect(html).toContain("push('failed to load: '");
    expect(html).toContain("window.addEventListener('unhandledrejection'");
  });

  it("opens on two fingers held still, never on one (the game's own hold)", () => {
    const html = read("index.html");
    expect(html).toContain("if (count() === 2) {");
    expect(html).toMatch(/window\.__devendDiag\(\); return; \}/);
  });

  it("is installed first in main.tsx, and has an Admin button", () => {
    const main = read("src/main.tsx");
    expect(main.indexOf("installBootDiagnostics();")).toBeLessThan(main.indexOf("loadSoundSettings();"));
    expect(read("src/components/admin/AdminScreen.tsx")).toContain("onClick={() => showDiagnostics()}");
  });
});
