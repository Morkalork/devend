/**
 * TenureDraftScreen (issue #75) — the pick contract.
 *
 * The logic tests cover which chains are offered; this covers the part the
 * player actually touches. It exists because the confirm button is the single
 * point where the reward is handed over: if `onConfirm` never fires, the run
 * starts with nothing and the screen simply sits there, which is exactly the
 * failure mode that is invisible in a logic test.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TenureDraftScreen } from "@/components/game/TenureDraftScreen";
import type { TenureOffer } from "@/lib/tenure";
import type { UpgradeConfig } from "@/types/upgrade";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Echo the key so assertions do not depend on copy, except: the
    // interpolated level (the thing under test in one case), and defaultValue,
    // which is how contentText falls back to an upgrade's raw name/description
    // when no translation exists. Ignoring it would render bare i18n keys.
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && "level" in opts) return `${key}:${opts.level}`;
      if (opts && "defaultValue" in opts) return opts.defaultValue as string;
      return key;
    },
  }),
}));
// The CRT background measures layout and schedules timers; irrelevant here.
vi.mock("@/components/game/CRTBackground", () => ({ CRTBackground: () => null }));

const up = (id: string, tier: UpgradeConfig["tier"]): UpgradeConfig => ({
  id, name: id, tier, description: `${id} does a thing`, modifiers: {},
});

const offer = (head: string, tiers: UpgradeConfig["tier"][]): TenureOffer => ({
  headId: head,
  name: head,
  upgrades: tiers.map((t, i) => up(`${head}_${i}`, t)),
});

const OFFERS: TenureOffer[] = [
  offer("alpha", ["Junior", "Senior", "Principal"]),
  offer("beta", ["Junior", "Senior", "Principal"]),
  offer("gamma", ["Junior", "Senior", "Principal"]),
];

const setup = (offers = OFFERS, earnedAtLevel = 30) => {
  const onConfirm = vi.fn();
  render(<TenureDraftScreen offers={offers} earnedAtLevel={earnedAtLevel} onConfirm={onConfirm} />);
  return { onConfirm };
};

const confirmButton = () => screen.getByRole("button", { name: /tenure\.(confirmButton|pickToStart)/ });

describe("picking a chain", () => {
  it("cannot confirm before anything is selected", () => {
    const { onConfirm } = setup();
    expect(confirmButton()).toBeDisabled();
    fireEvent.click(confirmButton());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  /** The load-bearing one: selecting then confirming must hand back the head id. */
  it("confirms the selected chain by its head id", () => {
    const { onConfirm } = setup();
    fireEvent.click(screen.getByText("beta_0"));
    expect(confirmButton()).toBeEnabled();

    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("beta");
  });

  it("lets the player change their mind before confirming", () => {
    const { onConfirm } = setup();
    fireEvent.click(screen.getByText("alpha_0"));
    fireEvent.click(screen.getByText("gamma_0"));
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith("gamma");
  });

  it("deselects when the same card is tapped twice, disabling confirm again", () => {
    const { onConfirm } = setup();
    fireEvent.click(screen.getByText("alpha_0"));
    fireEvent.click(screen.getByText("alpha_0"));
    expect(confirmButton()).toBeDisabled();
    fireEvent.click(confirmButton());
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("what the cards show", () => {
  /**
   * A 30-level reward must visibly beat a 20-level one. Showing only the head
   * would make the three tiers indistinguishable on screen.
   */
  it("lists every tier that will be granted, not just the head", () => {
    setup();
    for (const id of ["alpha_0", "alpha_1", "alpha_2"]) {
      expect(screen.getByText(`${id} does a thing`)).toBeTruthy();
    }
  });

  it("renders one card per offer", () => {
    setup();
    for (const head of ["alpha", "beta", "gamma"]) {
      expect(screen.getByText(`${head}_0`)).toBeTruthy();
    }
  });

  it("shows a single-tier reward when only one step was earned", () => {
    setup([offer("solo", ["Junior"])], 10);
    expect(screen.getByText("solo_0 does a thing")).toBeTruthy();
    expect(screen.queryByText("solo_1 does a thing")).toBeNull();
  });

  it("names the level the reward was earned at", () => {
    setup(OFFERS, 22);
    expect(screen.getByText("tenure.subtitle:22")).toBeTruthy();
  });
});
