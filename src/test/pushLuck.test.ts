/**
 * Push Your Luck pays one number, and you can always stop.
 *
 * Two things are pinned here, and they are pinned together because they are the
 * same defect seen twice.
 *
 * THE EXIT. Taking the push handed the board back with no visible way to stop.
 * The only ends were locking every ball or failing, so a map whose last ball
 * cannot be sealed was a dead run: cutting at a board that will never finish,
 * with hours already earned and no way to take them. An exit was added later
 * but was a 10%-opacity outline buried in the bottom stack, and was then
 * reported as missing, which is the only review that counts.
 *
 * THE NUMBER. The payout arithmetic existed in three hand-written copies (the
 * bank path, and both game-over paths). That was survivable while nothing else
 * read it. It stops being survivable the moment the exit button shows what you
 * are about to bank, because a fourth copy is a promise the payout has no
 * obligation to keep.
 */
import { describe, it, expect } from "vitest";
import { pushBonusEarned, pushChunkSize, canStopPushing, type PushExitState } from "@/lib/pushLuck";

describe("what a push has earned", () => {
  it("pays an hour for each quarter of the board that was left when it began", () => {
    // 40% remaining at the prompt: a chunk is 10 points of board.
    expect(pushChunkSize(40)).toBe(10);
    expect(pushBonusEarned(40, 30, 1)).toBe(1);
    expect(pushBonusEarned(40, 20, 1)).toBe(2);
    expect(pushBonusEarned(40, 0, 1)).toBe(4);
  });

  it("pays only for chunks that are actually finished", () => {
    // Floored, not rounded. The button and the results screen show the same
    // number, so rounding up here would have the button promise an hour that
    // the payout then declines to give.
    expect(pushBonusEarned(40, 31, 1)).toBe(0);
    expect(pushBonusEarned(40, 21, 1)).toBe(1);
  });

  it("measures chunks against the start, not against what is left", () => {
    // The reward for pushing must not shrink as you succeed at it. Were the
    // chunk re-measured against the current remainder it would keep halving,
    // and the last stretch of a map would pay almost nothing.
    expect(pushBonusEarned(40, 20, 1)).toBe(2);
    expect(pushChunkSize(40)).toBe(10);
  });

  it("pays nothing rather than something negative when the board grows back", () => {
    // Scope Creep and unsealed balls can push the remainder back UP. A push is
    // advertised as risk free, so the worst it may ever do is pay nothing.
    expect(pushBonusEarned(40, 55, 1)).toBe(0);
  });

  it("cannot turn a shrinking board plus a bad multiplier into a windfall", () => {
    // Two guards look redundant here and are not. Without clamping the CLEARED
    // area at zero, a board that grew back (cleared = -15) multiplied by a
    // negative multiplier comes out POSITIVE, sails past the payout clamp, and
    // pays six hours for losing ground. Each guard alone leaves that open.
    expect(pushBonusEarned(40, 55, -3)).toBe(0);
  });

  it("survives a map that was already fully cleared", () => {
    // Nothing left when the prompt opened means a chunk of zero, and the naive
    // form of this divides by it.
    expect(pushBonusEarned(0, 0, 1)).toBe(0);
    expect(Number.isFinite(pushBonusEarned(0, 0, 2))).toBe(true);
  });

  it("scales with the upgrade multiplier", () => {
    expect(pushBonusEarned(40, 0, 2)).toBe(8);
    expect(pushBonusEarned(40, 0, 1.5)).toBe(6);
  });

  it("never turns a broken multiplier into a punishment", () => {
    // These come from upgrades and the admin playground. A push that took
    // hours AWAY would break the one promise the prompt makes out loud.
    expect(pushBonusEarned(40, 0, -3)).toBe(0);
    expect(pushBonusEarned(40, 0, NaN)).toBe(0);
  });
});

describe("being allowed to stop", () => {
  const state = (over: Partial<PushExitState> = {}): PushExitState => ({
    mapComplete: false,
    pushMode: "pushing",
    hasHandler: true,
    ...over,
  });

  it("offers a way out while pushing", () => {
    // THE regression. Without this the player is in a trap they opted into
    // without being told it was one.
    expect(canStopPushing(state())).toBe(true);
  });

  it("stays out of the prompt, which has its own Bank button", () => {
    // Two controls doing one job on one screen, and the prompt's is the one
    // that also explains the choice.
    expect(canStopPushing(state({ pushMode: "prompt" }))).toBe(false);
  });

  it("does not appear when no push is running", () => {
    expect(canStopPushing(state({ pushMode: "none" }))).toBe(false);
  });

  it("goes away the instant the map is finished", () => {
    // Locking the last ball mid-push completes the level while this is still on
    // screen; banking then would queue a second dissolve, which was seen in the
    // wild as two Promotion drafts in a row.
    expect(canStopPushing(state({ mapComplete: true }))).toBe(false);
  });

  it("does not render a button that cannot do anything", () => {
    // The handler arrives from the canvas via a state push, so there is a
    // window where the mode says pushing and nothing is wired to the click.
    expect(canStopPushing(state({ hasHandler: false }))).toBe(false);
  });
});
