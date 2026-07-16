/**
 * Welcome screen Continue / New Game buttons: a saved run in progress offers
 * both Continue (resume) and New Game; with no save, a single Start Game button.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@/i18n"; // side-effect: initialise react-i18next synchronously
import { WelcomeScreen } from "@/components/game/WelcomeScreen";

afterEach(cleanup);

describe("WelcomeScreen Continue / New Game", () => {
  it("shows a single Start Game button when there is no saved run", () => {
    render(<WelcomeScreen onStartGame={vi.fn()} onTutorial={vi.fn()} onOptions={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Start Game" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New Game" })).toBeNull();
  });

  it("shows Continue + New Game when a saved run exists, wired to the right handlers", () => {
    const onContinue = vi.fn();
    const onStartGame = vi.fn();
    render(
      <WelcomeScreen onStartGame={onStartGame} onContinue={onContinue} onTutorial={vi.fn()} onOptions={vi.fn()} />
    );

    const cont = screen.getByRole("button", { name: "Continue" });
    const fresh = screen.getByRole("button", { name: "New Game" });
    expect(screen.queryByRole("button", { name: "Start Game" })).toBeNull();

    fireEvent.click(cont);
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onStartGame).not.toHaveBeenCalled();

    fireEvent.click(fresh);
    expect(onStartGame).toHaveBeenCalledTimes(1);
  });
});
