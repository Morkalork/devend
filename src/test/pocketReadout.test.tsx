/**
 * The Map Builder measures a map's pockets on demand.
 *
 * The probe behind mapPockets.test.ts, surfaced where a map is designed, so the
 * number is read while the nook is being drawn rather than after a lint fails.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LevelPanel } from "@/components/admin/LevelPanel";
import { LADDER, byLevel } from "./fixtures/maps";

describe("the Measure pockets button", () => {
  it("reports the smallest one-fence pocket and whether it grades superior", () => {
    render(<LevelPanel level={byLevel(LADDER, 1)!} onUpdateLevel={() => {}} />);
    expect(screen.queryByText(/Smallest one-fence pocket/)).toBeNull();
    fireEvent.click(screen.getByText("Measure pockets"));
    const out = screen.getByText(/Smallest one-fence pocket/).textContent ?? "";
    expect(out).toMatch(/\d+\.\d\d% of the board/);
    expect(out).toMatch(/Superior at the start needs 4\.00% \(yes\)/);
    expect(out).toMatch(/Room to draw/);
  });
});
