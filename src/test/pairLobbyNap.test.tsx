/**
 * The 2-Player screen says what the server is up to.
 *
 * A napping dyno used to look like a broken mode: a QR that never led
 * anywhere and a spinner with no explanation. Now the screen says the server
 * is waking, and holding the line explains why a server would sleep at all.
 * Driven through Admin's simulated nap, the same switch a tester uses, so the
 * test and the tester see the same thing.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import "@/i18n";
import { PairLobby } from "@/components/game/PairLobby";
import { setSimulatedNap } from "@/lib/devFlags";

afterEach(() => {
  cleanup();
  setSimulatedNap("off");
  vi.useRealTimers();
});

describe("the server nap readout", () => {
  it("says the server is waking, and explains itself on a hold", () => {
    vi.useFakeTimers();
    setSimulatedNap("asleep");
    render(<PairLobby onBack={() => {}} onPaired={() => {}} />);
    const chip = screen.getByTestId("server-nap");
    expect(chip.getAttribute("data-state")).toBe("waking");
    expect(chip.textContent).toMatch(/napping/i);

    // A tap is not a hold: nothing opens.
    fireEvent.pointerDown(chip);
    fireEvent.pointerUp(chip);
    act(() => { vi.advanceTimersByTime(600); });
    expect(screen.queryByText(/Why would a server sleep/)).toBeNull();

    fireEvent.pointerDown(chip);
    act(() => { vi.advanceTimersByTime(460); });
    expect(screen.getByText(/Why would a server sleep/)).toBeTruthy();
    expect(screen.getByText(/find its slippers/)).toBeTruthy();
  });

  it("says plainly when the server cannot be reached", () => {
    setSimulatedNap("unreachable");
    render(<PairLobby onBack={() => {}} onPaired={() => {}} />);
    expect(screen.getByTestId("server-nap").getAttribute("data-state")).toBe("unreachable");
  });
});
