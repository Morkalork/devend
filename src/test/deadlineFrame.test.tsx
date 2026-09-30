/**
 * The map clock on the board's frame.
 *
 * Reported: "the map countdown has to be more prevalent, it is easy to miss".
 * It was a 6px bar under the fence slots that also gave up its row to the
 * refusal message. The clock now drains round the board's own frame, and the
 * milestone seconds flash over the board ahead of the final-ten alarm.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "@/i18n";
import { DeadlineFrame } from "@/components/game/DeadlineFrame";
import { BoardAlert } from "@/components/game/BoardAlert";
import type { BoardFrameCss } from "@/components/game/BoardPlaceholder";
import {
  DEADLINE_MILESTONES, clockRectPath, deadlineColor, deadlineMilestone,
} from "@/lib/deadlineDisplay";

afterEach(() => {
  cleanup();
});

const FRAME: BoardFrameCss = { left: 6, top: 40, width: 388, height: 388, frame: 6 };

describe("deadlineMilestone", () => {
  it("fires at 30 and 20 seconds left, and nowhere else", () => {
    const fired = Array.from({ length: 61 }, (_, s) => deadlineMilestone(s, 60)).filter(m => m != null);
    expect(fired.sort()).toEqual([...DEADLINE_MILESTONES].sort());
  });

  it("does not open a map by flashing its own limit", () => {
    expect(deadlineMilestone(30, 30)).toBeNull();
    expect(deadlineMilestone(20, 25)).toBe(20);
    expect(deadlineMilestone(30, 25)).toBeNull();
  });

  it("stays above the final-ten alarm, so the two never flash the same second", () => {
    for (const m of DEADLINE_MILESTONES) {
      expect(m).toBeGreaterThan(10);
    }
  });
});

describe("clockRectPath", () => {
  it("starts at twelve o'clock and goes round the whole rectangle", () => {
    const { d, length } = clockRectPath(3, 3, 100, 80);
    expect(d.startsWith("M 53 3")).toBe(true);
    expect(d.endsWith("H 53")).toBe(true);
    expect(length).toBe(360);
  });
});

describe("deadlineColor", () => {
  it("runs green to red as the clock empties", () => {
    expect(deadlineColor(1)).toBe("hsl(120, 85%, 52%)");
    expect(deadlineColor(0.5)).toBe("hsl(60, 85%, 52%)");
    expect(deadlineColor(0)).toBe("hsl(0, 85%, 52%)");
  });
});

describe("DeadlineFrame", () => {
  it("sits exactly on the board's frame", () => {
    const { getByTestId } = render(<DeadlineFrame frame={FRAME} secondsLeft={60} limit={60} />);
    const el = getByTestId("deadline-frame");
    expect(el.style.left).toBe("6px");
    expect(el.style.top).toBe("40px");
    expect(el.style.width).toBe("388px");
    expect(el.style.height).toBe("388px");
    expect(el.className).toContain("pointer-events-none");
  });

  it("drains in step with the clock", () => {
    const length = 2 * (388 - 6) * 2;
    const offset = (secondsLeft: number) => {
      const { getByTestId, unmount } = render(<DeadlineFrame frame={FRAME} secondsLeft={secondsLeft} limit={60} />);
      const v = Number(getByTestId("deadline-frame-fill").getAttribute("stroke-dashoffset"));
      unmount();
      return v;
    };
    expect(offset(60)).toBeCloseTo(0);
    expect(offset(30)).toBeCloseTo(length / 2);
    expect(offset(0)).toBeCloseTo(length);
  });

  it("flashes the number at a milestone and not in between", () => {
    const at30 = render(<DeadlineFrame frame={FRAME} secondsLeft={30} limit={60} />);
    expect(at30.getByTestId("deadline-milestone").textContent).toBe("30");
    at30.unmount();
    const at29 = render(<DeadlineFrame frame={FRAME} secondsLeft={29} limit={60} />);
    expect(at29.queryByTestId("deadline-milestone")).toBeNull();
  });

  it("draws nothing without a clock or before the board is sized", () => {
    expect(render(<DeadlineFrame frame={FRAME} secondsLeft={null} limit={60} />).container.innerHTML).toBe("");
    expect(render(<DeadlineFrame frame={FRAME} secondsLeft={20} limit={null} />).container.innerHTML).toBe("");
    expect(render(<DeadlineFrame frame={null} secondsLeft={20} limit={60} />).container.innerHTML).toBe("");
  });
});

describe("the countdown numerals", () => {
  it("share one CSS flash, played once per mount", () => {
    const m = render(<DeadlineFrame frame={FRAME} secondsLeft={20} limit={60} />);
    expect(m.getByTestId("deadline-milestone").className).toContain("animate-deadline-flash");
    m.unmount();
    const alarm = render(<BoardAlert urgent seconds={7} />);
    expect(alarm.getByTestId("board-alert-numeral").className).toContain("animate-deadline-flash");
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    expect(css).toContain("@keyframes deadline-flash");
    expect(css).toMatch(/\.animate-deadline-flash\s*\{[^}]*forwards/);
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("GameCanvas draws the frame, and GameScreen feeds it the clock", () => {
    expect(read("src/components/game/GameCanvas.tsx")).toContain("<DeadlineFrame");
    const screen = read("src/components/game/GameScreen.tsx");
    expect(screen).toContain("deadlineSecondsLeft={deadlineShown ? deadlineRemaining : null}");
    expect(screen).toContain("playDeadlineTickSound()");
  });
});
