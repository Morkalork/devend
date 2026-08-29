/**
 * The codex draws the same marks the board does.
 *
 * A mark on the board that is never explained is decoration, so the ball roster
 * carries the mark next to the name and the description - that page is where
 * "two bars means heavy" gets learned. Which creates the one failure worth
 * guarding: the roster and the board drifting apart, and the codex confidently
 * teaching a symbol the game does not draw.
 *
 * They cannot drift, because BallMark renders straight out of BALL_MARKS rather
 * than redrawing the shapes in SVG by hand. This checks that that stays true,
 * by counting the shapes on the page against the table.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { BallMark } from "@/components/game/BallMark";
import { BALL_MARKS, markColor } from "@/lib/rendering/sleek/ballMark";

afterEach(cleanup);

/** Every shape element the component emitted, in document order. */
function shapes(el: HTMLElement) {
  return [...el.querySelectorAll("polyline, circle")];
}

describe("a ball's mark in the codex", () => {
  it("draws one shape per stroke, for every ability the game has", () => {
    // Counting against the table is what makes this a drift guard rather than a
    // snapshot: add a stroke to a mark and the codex must grow one too.
    for (const [ability, strokes] of Object.entries(BALL_MARKS)) {
      const { container, unmount } = render(
        <BallMark ability={ability} color="#ff5b5b" size={48} />,
      );
      expect(shapes(container).length, `${ability} drew the wrong number of shapes`)
        .toBe(strokes.length);
      unmount();
    }
  });

  it("renders nothing at all for a ball that just rolls", () => {
    // Not an empty svg - nothing. An empty box still takes layout space and
    // would push the roster's text out of line on exactly two rows.
    const { container } = render(<BallMark ability="none" color="#ff5b5b" size={48} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for an ability it has no mark for", () => {
    const { container } = render(<BallMark ability="notAThing" color="#ff5b5b" size={48} />);
    expect(container.innerHTML).toBe("");
  });

  it("inks the mark the same way the board does", () => {
    // The light/dark decision is markColor's, in the same module the renderer
    // uses. A second threshold here would make white balls legible in the codex
    // and invisible on the board, or the reverse.
    const { container } = render(<BallMark ability="tappable" color="#ffffff" size={48} />);
    const fill = container.querySelector("circle")!.getAttribute("fill");
    expect(fill).toBe(`#${markColor("#ffffff").toString(16).padStart(6, "0")}`);
  });

  it("closes a closed shape rather than leaving it open", () => {
    // moneyBall's gem and breakObjects' wedge are closed polygons. An unclosed
    // polyline reads as a bent line, not a shape, at codex size and worse on
    // the board.
    const { container } = render(<BallMark ability="moneyBall" color="#00c853" size={48} />);
    const pts = container.querySelector("polyline")!.getAttribute("points")!.split(" ");
    expect(pts[0]).toBe(pts[pts.length - 1]);
  });

  it("keeps the stroke proportional to the swatch", () => {
    // The viewBox is the unit ball, so a stroke in that space is already
    // relative: a swatch four times the size must NOT get four times the
    // relative width, or the mark thickens into a blob as it grows.
    const big = render(<BallMark ability="turnTimer" color="#c08cff" size={96} />);
    const wBig = Number(big.container.querySelector("polyline")!.getAttribute("stroke-width"));
    big.unmount();
    const mid = render(<BallMark ability="turnTimer" color="#c08cff" size={24} />);
    const wMid = Number(mid.container.querySelector("polyline")!.getAttribute("stroke-width"));
    mid.unmount();
    expect(wMid).toBeCloseTo(wBig, 6);
    expect(wBig).toBeGreaterThan(0);

    // Below markWidth's pixel floor it stops being proportional on purpose:
    // a tiny swatch gets a relatively FATTER stroke, because a sub-pixel line
    // is not a faint mark, it is nothing.
    const tiny = render(<BallMark ability="turnTimer" color="#c08cff" size={12} />);
    const wTiny = Number(tiny.container.querySelector("polyline")!.getAttribute("stroke-width"));
    expect(wTiny).toBeGreaterThan(wBig);
  });
});
