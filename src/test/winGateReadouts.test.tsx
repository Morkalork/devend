/**
 * The two readouts that make an unusual win obvious.
 *
 * "I want the win-scenarios to be as clear as day." The chip carries which
 * requirement and how far along you are; the frame around the board carries the
 * at-a-glance "this is not a normal clear". Between them they replace a line of
 * text inside the hamburger menu.
 *
 * The design decision worth guarding is the one that is easy to undo by
 * accident: the frame has ONE state. The request was a distinct border per
 * condition kind, and the reason it is not is arithmetic rather than taste -
 * seven unusual kinds exist, a player meets three of them, at levels 32 to 34,
 * so each border would be seen once or twice in a whole run. A code seen twice
 * is a second puzzle, not a signal. If someone later adds a colour per kind,
 * the count test below is what says so out loud.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "@/i18n";
import { WinGateChip } from "@/components/game/WinGateChip";
import { WinGateFrame } from "@/components/game/WinGateFrame";
import type { WinConditionProgress } from "@/types/winSpec";

afterEach(cleanup);

const ACCENT = "#00ff88";

const gate = (over: Partial<WinConditionProgress> = {}): WinConditionProgress => ({
  condition: { kind: "superiorLocks", count: 1 },
  current: 0, target: 1, met: false, mode: "accumulate", ...over,
});

describe("the requirement chip", () => {
  it("says how far along you are, not merely that a rule exists", () => {
    // THE thing a border could never carry, and the reason the chip exists
    // alongside the frame rather than instead of it.
    render(<WinGateChip gate={gate({ current: 1, target: 3 })} accentColor={ACCENT} />);
    expect(screen.getByText("1/3")).toBeTruthy();
  });

  it("names the requirement in words", () => {
    render(<WinGateChip gate={gate()} accentColor={ACCENT} />);
    expect(screen.getAllByText(/Superior/i).length).toBeGreaterThan(0);
  });

  it("names the actual ball on a seal-this-type map", () => {
    // "Seal a ball" and "seal a LODESTONE" are different maps, and the type is
    // the entire requirement on level 33.
    render(
      <WinGateChip
        gate={gate({ condition: { kind: "lockType", ballType: "Lodestone", count: 1 } })}
        accentColor={ACCENT}
      />,
    );
    expect(screen.getAllByText(/Lodestone/).length).toBeGreaterThan(0);
  });

  it("lights up the moment it is satisfied", () => {
    // Follows the lock chip's existing states so it reads as part of that row.
    const { container } = render(
      <WinGateChip gate={gate({ current: 1, met: true })} accentColor={ACCENT} />,
    );
    const value = screen.getByText("1/1");
    expect(value.getAttribute("style")).toContain("rgb(0, 255, 136)");
    expect(container.querySelector("svg")!.getAttribute("style")).toContain("drop-shadow");
  });

  it("does not light up for a constraint that has merely not been blown yet", () => {
    // A limit clause reads as `met` from the first frame. Showing it in the
    // completion colour would tell the player they had banked something they
    // have not started earning.
    render(
      <WinGateChip
        gate={gate({ condition: { kind: "underPar", delta: 0 }, met: true, mode: "limit" })}
        accentColor={ACCENT}
      />,
    );
    expect(screen.getByText("0/1").getAttribute("style")).not.toContain("rgb(0, 255, 136)");
  });

  it("opens the how-to-win text when tapped", () => {
    // The chip is the short form; the full wording already exists and was only
    // ever reachable through the menu.
    let opened = 0;
    render(<WinGateChip gate={gate()} accentColor={ACCENT} onExplain={() => { opened++; }} />);
    fireEvent.click(screen.getByRole("button"));
    expect(opened).toBe(1);
  });
});

describe("the board frame", () => {
  it("is not drawn at all on an ordinary map", () => {
    // A frame that is merely dimmer on 37 of 40 maps is chrome, and the eye
    // stops seeing it exactly where it matters.
    const { container } = render(<WinGateFrame present={false} outstanding={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("is drawn while the requirement is outstanding", () => {
    const { container } = render(<WinGateFrame present outstanding />);
    expect(container.firstElementChild).toBeTruthy();
  });

  it("is never the accent colour", () => {
    // THE constraint. The accent means "done" everywhere else in the HUD - a
    // satisfied chip, a locked pocket, the CLEAR readout. A frame in the
    // completion colour, drawn precisely when the map is NOT complete, would
    // say the opposite of what it means.
    const { container } = render(<WinGateFrame present outstanding />);
    const style = (container.firstElementChild as HTMLElement).getAttribute("style") ?? "";
    expect(style).not.toContain("rgb(0, 255, 136)");
    expect(style).not.toContain("#00ff88");
    expect(style.toLowerCase()).toContain("ffb347");
  });

  it("sits in the board's own coordinate space, never fixed to the viewport", () => {
    // The page-transition transform breaks fixed positioning, so board-aligned
    // UI has to be absolute inside the board wrapper. This has been got wrong
    // before, by the tutorial overlay.
    const { container } = render(<WinGateFrame present outstanding />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("absolute");
    expect(el.className).not.toContain("fixed");
  });

  it("never swallows a tap meant for the board", () => {
    // It covers the whole play area. Without this the player could not cut.
    const { container } = render(<WinGateFrame present outstanding />);
    expect((container.firstElementChild as HTMLElement).className)
      .toContain("pointer-events-none");
  });
});

describe("the frame stays one state", () => {
  it("has no per-condition colour table", () => {
    // The guard on the design decision. A colour per kind is the thing this was
    // deliberately not built as: seven kinds, three ever seen, so each border
    // would be met once or twice a run and never learned. If someone adds one,
    // this fails and they have to argue with the comment rather than with a
    // silent test.
    const raw = readFileSync(
      resolve(process.cwd(), "src/components/game/WinGateFrame.tsx"), "utf8",
    );
    // Comments stripped first: the file EXPLAINS the coloured-area gate and
    // the play area at length, and this is a claim about the code.
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").map(l => l.split("//")[0]).join("\n");
    const hexes = new Set(code.match(/#[0-9a-fA-F]{6}/g) ?? []);
    expect([...hexes], "the frame grew a colour per condition kind").toHaveLength(1);
    for (const kind of ["superiorLocks", "area", "lockType", "speedClear"]) {
      expect(code, `the frame started branching on ${kind}`).not.toContain(kind);
    }
  });
});
