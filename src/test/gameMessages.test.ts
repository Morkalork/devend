/**
 * Telling the player why the thing they just tried did nothing.
 *
 * Six places in the input layer refused a cut. Five said so only to the dev
 * console, and the sixth (anchoring on a breakable) gave a buzz and a flash,
 * which says "no" without saying why. From the player's side a fence they drew
 * all the way simply failed to appear, which reads as a bug rather than a rule.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  raiseMessage, messageExpired, GAME_MESSAGE_IDS, MESSAGE_MS,
  type GameMessage, type GameMessageId,
} from "@/lib/gameMessages";
import { pickContext } from "@/lib/hudContext";

describe("exactly one message at a time", () => {
  it("starts empty and takes the first message raised", () => {
    const m = raiseMessage(null, "breakableAnchor", 1000);
    expect(m.id).toBe("breakableAnchor");
    expect(m.at).toBe(1000);
  });

  /**
   * A queue would make a player who mashes the same illegal cut sit through
   * five copies of one sentence, and by the last they have forgotten what they
   * did. The newest simply replaces whatever was there.
   */
  it("replaces rather than queues", () => {
    const first = raiseMessage(null, "breakableAnchor", 1000);
    const second = raiseMessage(first, "fenceLimit", 1200);
    expect(second.id).toBe("fenceLimit");
  });

  it("bumps the sequence only when the message actually changes", () => {
    const first = raiseMessage(null, "breakableAnchor", 1000);
    const repeat = raiseMessage(first, "breakableAnchor", 1500);
    const different = raiseMessage(repeat, "wallInTheWay", 1600);
    expect(repeat.seq, "a repeat must not re-animate the bar").toBe(first.seq);
    expect(different.seq).toBeGreaterThan(repeat.seq);
  });

  /** The bar animates on `seq`, so a run of failed attempts reads as one
   *  steady explanation rather than a flicker. */
  it("refreshes the clock on a repeat instead of restarting the entrance", () => {
    const first = raiseMessage(null, "fenceLimit", 1000);
    const repeat = raiseMessage(first, "fenceLimit", 3000);
    expect(repeat.at, "the deadline should move").toBe(3000);
    expect(repeat.seq).toBe(first.seq);
  });

  it("keeps a repeat alive as long as the player keeps trying", () => {
    let m: GameMessage = raiseMessage(null, "fenceLimit", 0);
    for (let t = 1000; t <= 20000; t += 1000) {
      m = raiseMessage(m, "fenceLimit", t);
      expect(messageExpired(m, t), `still trying at ${t}ms`).toBe(false);
    }
  });
});

describe("when a message goes away", () => {
  it("expires after its lifetime", () => {
    const m = raiseMessage(null, "capturedStart", 1000);
    expect(messageExpired(m, 1000 + MESSAGE_MS - 1)).toBe(false);
    expect(messageExpired(m, 1000 + MESSAGE_MS)).toBe(true);
  });

  it("treats an empty slot as nothing to expire", () => {
    expect(messageExpired(null, 99999)).toBe(false);
  });
});

/**
 * Every id must have words, in every language, or a refusal shows a raw key -
 * which is worse than the silence it replaced.
 */
describe("every message has words", () => {
  const LOCALES = ["en", "es", "sv"] as const;
  const load = (loc: string) => JSON.parse(
    readFileSync(resolve(__dirname, `../i18n/locales/${loc}.json`), "utf8"),
  ) as { gameMessages?: Record<string, string> };

  it.each(LOCALES)("%s has a line for each", (loc) => {
    const msgs = load(loc).gameMessages;
    expect(msgs, `${loc} has no gameMessages block`).toBeTruthy();
    for (const id of GAME_MESSAGE_IDS) {
      expect(msgs![id], `${loc} missing ${id}`).toBeTruthy();
    }
  });

  it.each(LOCALES)("%s carries no key the code cannot raise", (loc) => {
    const msgs = load(loc).gameMessages ?? {};
    expect(Object.keys(msgs).sort()).toEqual([...GAME_MESSAGE_IDS].sort());
  });

  /** The project rule: no em-dashes anywhere a player can read them. */
  it.each(LOCALES)("%s keeps em-dashes out", (loc) => {
    expect(JSON.stringify(load(loc).gameMessages)).not.toContain("—");
  });

  /**
   * Each line has to say what to do instead, not just that it failed. "That
   * did not work" is the silence with extra steps.
   */
  it("tells the player what to do about it", () => {
    const en = load("en").gameMessages!;
    for (const id of GAME_MESSAGE_IDS) {
      expect(en[id].length, `${id} is too terse to help`).toBeGreaterThan(40);
      expect(en[id], `${id} should suggest a way forward`).toMatch(/[.!]/);
    }
  });
});

/**
 * The wiring. A message catalogue nobody raises is the same silence it was
 * written to end, and five of these six sites were a bare `return`.
 */
describe("the refusals actually raise one", () => {
  const INPUT = readFileSync(
    resolve(__dirname, "../hooks/useGameInput.ts"), "utf8");
  /**
   * Every module allowed to put a sentence in the bar.
   *
   * It used to be useGameInput alone, because every message was an input
   * refusal. The physics layer raises two now - a ball or a mover cutting a
   * fence you were drawing, which costs a life and lets play continue - so the
   * check is "raised from one of the raising sites" rather than "raised from
   * that one file". Still not a whole-tree grep: a message id that appears
   * only in a test or a locale file is exactly the silence this guards.
   */
  const RAISERS = [
    "../hooks/useGameInput.ts",
    "../lib/physics/updateFenceWall.ts",
  ].map(f => readFileSync(resolve(__dirname, f), "utf8")).join("\n");

  it.each(GAME_MESSAGE_IDS)("raises %s somewhere", (id: GameMessageId) => {
    expect(RAISERS).toContain(`("${id}")`);
  });

  it("says something at the breakable dud, not just a buzz", () => {
    const dud = INPUT.slice(INPUT.indexOf("cutAnchorsBreakable(game"), INPUT.indexOf("game.wallCount += 1"));
    expect(dud).toMatch(/breakableAnchor/);
    expect(dud, "the haptic stays: the words explain, the buzz confirms").toMatch(/vibrate/);
  });

  it("leaves no refusal that only talks to the dev console", () => {
    // Every console.warn about a refused cut must have a player-facing message
    // beside it, or the player is back to watching nothing happen.
    const warns = INPUT.split("\n")
      .map((l, i) => [l, i] as const)
      .filter(([l]) => l.includes("[cut-refused]"));
    expect(warns.length, "expected the refusal warnings to still exist").toBeGreaterThan(0);
    const lines = INPUT.split("\n");
    for (const [, i] of warns) {
      // Seven lines, not four: a refusal may carry a comment explaining why it
      // says what it says, and the first version of this window stopped just
      // short of the call on exactly that case.
      const near = lines.slice(i, i + 7).join("\n");
      expect(near, `the refusal at line ${i + 1} says nothing to the player`)
        .toMatch(/onMessageRef/);
    }
  });
});

/**
 * Placement. The bar explains a failed cut, so hiding the board it failed on
 * would defeat the point.
 */
describe("it sits below the board", () => {
  const BAR = readFileSync(
    resolve(__dirname, "../components/game/GameMessageBar.tsx"), "utf8");
  const SCREEN = readFileSync(
    resolve(__dirname, "../components/game/GameScreen.tsx"), "utf8");

  it("renders in the fixed bottom stack, with the other under-board UI", () => {
    // Anchored on the wrapper and read to the end of the file: slicing to
    // indexOf("AbilityCountdownBar") found its IMPORT, hundreds of lines above
    // the stack, and produced an empty string that matched nothing.
    const stack = SCREEN.slice(SCREEN.indexOf("fixed bottom-0"));
    expect(stack).toMatch(/GameMessageBar/);
  });

  it("hides the instant the map is won, like everything else down there", () => {
    // The rule has not changed; where it is enforced has. The bar used to carry
    // `visible={!mapComplete}` itself. It now shares one reserved-height slot
    // with the Ship Early countdown and the ability timers, and the slot's
    // owner is chosen by pickContext - so THAT is where "not once the map is
    // over" has to hold, and asserting the old prop would only pin a mechanism
    // that moved.
    expect(pickContext({
      mapComplete: true, hasMessage: true, shipEarlyVisible: true, timerCount: 3,
    }), "a readout outlived the board").toBeNull();
    // And it is still reachable while the map is running, or the above passes
    // for the wrong reason.
    expect(pickContext({
      mapComplete: false, hasMessage: true, shipEarlyVisible: false, timerCount: 0,
    })).toBe("message");
  });

  it("never eats a tap meant for the board", () => {
    expect(BAR).toMatch(/pointer-events-none/);
  });
});
