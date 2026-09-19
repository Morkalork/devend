/**
 * The ten things that would have broken the first real two-phone session.
 *
 * Each of these was found by reading the shipped code rather than by playing
 * it, which is the point: none of them can be reproduced without two devices,
 * and several of them would look like "the mode is broken" rather than like a
 * specific bug. So they are pinned here, where one machine is enough.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { electPlayer, pairIdFor } from "@/lib/net/deviceId";
import { modifierHash } from "@/lib/net/stateHash";
import { applyCommand, setLocalPlayer, type GameCommand } from "@/lib/net/commands";
import { STALL_GIVE_UP_MS, RECORD_WINDOW_TICKS } from "@/lib/net/lockstep";
import { plainModifiers } from "@/lib/bot/headlessGame";
import type { CanvasGameState } from "@/types/gameState";

const read = (p: string) => readFileSync(p, "utf8");

afterEach(() => setLocalPlayer(0));

describe("the host election", () => {
  it("makes exactly one of the two phones player 0", () => {
    // The bug: the election read the partner's device id from a ref the hello
    // had not filled yet, so on a first Nearby connect both phones read null
    // and both concluded they were the host. Two player zeros, every command
    // from both stamped the same, and both sides owning the repair.
    const a = electPlayer("device-aaa", "device-bbb");
    const b = electPlayer("device-bbb", "device-aaa");
    expect(a).toBe(0);
    expect(b).toBe(1);
    expect(a === 0 && b === 0, "both phones elected themselves host").toBe(false);
  });

  it("agrees whichever order the ids arrive in, for any pair", () => {
    const ids = ["0", "a", "zz", "device-1", "device-2", "ffff-0001", "ffff-0002"];
    for (const x of ids) {
      for (const y of ids) {
        if (x === y) continue;
        const mine = electPlayer(x, y);
        const theirs = electPlayer(y, x);
        expect(mine).not.toBeNull();
        expect(theirs).not.toBeNull();
        expect(mine! + theirs!, `${x} vs ${y} did not produce one of each`).toBe(1);
      }
    }
  });

  it("refuses two devices that cannot be told apart", () => {
    // A cloned install, or an id that did not persist. Both would be player 0,
    // so there is no answer to give and the caller has to say so.
    expect(electPlayer("same", "same")).toBeNull();
  });

  it("is decided after the hello, not before it", () => {
    const src = read("src/components/game/PairLobby.tsx");
    const handshake = src.slice(src.indexOf("const completeHandshake"), src.indexOf("const startNearby"));
    // The anchor is the AWAIT, not the first mention of the id: the election
    // names that id itself, so "first mention" is the election.
    const helloArrives = handshake.indexOf("const theirs = await");
    const elect = handshake.indexOf("electPlayer(");
    expect(helloArrives, "the handshake never waits for the partner's hello").toBeGreaterThan(-1);
    expect(elect, "the election is not in the handshake").toBeGreaterThan(-1);
    expect(elect, "the election runs before the id it needs has arrived")
      .toBeGreaterThan(helloArrives);
  });

  it("still names the same pair whichever phone hosts", () => {
    expect(pairIdFor("device-aaa", "device-bbb")).toBe(pairIdFor("device-bbb", "device-aaa"));
  });
});

describe("haptics belong to the hand that acted", () => {
  const board = () => ({
    balls: [], movers: [], activeWalls: [], walls: [], regions: [],
    pending: [], wallCount: 0,
  } as unknown as CanvasGameState);

  const grab: GameCommand = {
    kind: "moverGrab", player: 1, moverId: "nope",
    pointer: { x: 0, y: 0 }, driveMultiplier: 1, canDerail: false, canBand: false,
  };

  it("does not buzz this phone for the partner's command", () => {
    setLocalPlayer(0);
    let buzzed = false;
    // A mover that does not exist: the command is a no-op, which is fine. What
    // is being checked is that the vibrate dep never even reaches it.
    applyCommand(board(), grab, { modifiers: plainModifiers(), vibrate: () => { buzzed = true; } });
    expect(buzzed, "the phone buzzed for something its partner did").toBe(false);
  });

  it("still buzzes for its own", () => {
    setLocalPlayer(1);
    const game = board();
    game.movers = [{ id: "m", offset: 0 }] as unknown as CanvasGameState["movers"];
    let buzzed = false;
    applyCommand(game, { ...grab, moverId: "m" }, {
      modifiers: plainModifiers(), vibrate: () => { buzzed = true; },
    });
    expect(buzzed).toBe(true);
  });
});

describe("abilities travel as commands", () => {
  it("has a command for each of the three shapes the game has", () => {
    const src = read("src/lib/net/commands.ts");
    expect(src, "an untargeted ability is not a command").toMatch(/kind: "ability"/);
    expect(src, "the Magnet is not a command").toMatch(/kind: "abilityTarget"/);
    expect(src, "the Rubber Band is not a command").toMatch(/kind: "rubberBand"/);
  });

  it("does not fire one straight from the component any more", () => {
    // The bug: firing reached into the game state from the component that
    // noticed the press, so an ability moved one board and not the other, and
    // no snapshot can put that back.
    const src = read("src/components/game/GameCanvas.tsx");
    const withoutComments = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments, "fireAbility is still called from the canvas")
      .not.toMatch(/\bfireAbility\s*\(/);
    expect(withoutComments, "fireTargetedAbility is still called from the canvas")
      .not.toMatch(/\bfireTargetedAbility\s*\(/);
    expect(withoutComments, "fireRubberBand is still called from the canvas")
      .not.toMatch(/\bfireRubberBand\s*\(/);
    expect(src, "the canvas does not send ability commands").toMatch(/kind: "ability"/);
  });

  it("spends the charge where the command applies, so both mirrors agree", () => {
    const src = read("src/lib/net/commands.ts");
    expect(src).toMatch(/onAbilityFired\?\.\(/);
  });
});

describe("the run syncs at every map, not once", () => {
  it("publishes from the host on each map start", () => {
    const src = read("src/hooks/usePairSession.ts");
    expect(src, "the host never publishes its run per map").toMatch(/choice: "mapState"/);
    // Only the host: a guest saving its own idea of the run could later win
    // the "further along" comparison against the real one.
    const publish = src.slice(src.indexOf("const recordMap"), src.indexOf("const end ="));
    expect(publish).toMatch(/state\.isHost/);
  });

  it("gives the guest a way to adopt it without reloading the catalogues", () => {
    const session = read("src/hooks/useGameSession.ts");
    expect(session, "there is no mid-run way to adopt a record").toMatch(/applyRunRecord/);
    const index = read("src/pages/Index.tsx");
    expect(index, "the guest never adopts the host's run").toMatch(/applyRunRecord\(pairAdopt\.run\)/);
  });

  it("keeps the guest out of decisions about a run it does not own", () => {
    const index = read("src/pages/Index.tsx");
    expect(index, "the guest can still shop").toMatch(/PairGuestGate/);
    const canvas = read("src/components/game/GameCanvas.tsx");
    expect(canvas, "the guest can still answer the push prompt").toMatch(/!isPairGuest/);
  });
});

describe("a stall stays a stutter", () => {
  it("does not let the accumulator bank the time it waited", () => {
    // The bug: the accumulator filled at one frame per frame while nothing
    // drained it, so a two-second wait ran ~240 ticks in the frame the partner
    // came back and every ball teleported.
    const loop = read("src/hooks/useGameLoop.ts");
    const stall = loop.slice(loop.indexOf("if (!pair.tryReleaseTick(game))"));
    expect(stall.slice(0, 900), "the accumulator is not held during a stall")
      .toMatch(/game\.accumulator = Math\.min\(game\.accumulator, PHYSICS_STEP\)/);
  });

  it("gives up on a partner that has stopped answering", () => {
    // A phone that locks its screen stops getting frames and so stops sending,
    // and nothing about the socket says so. Without a deadline the other
    // player waits for ever.
    expect(STALL_GIVE_UP_MS).toBeGreaterThan(5_000);
    expect(STALL_GIVE_UP_MS).toBeLessThan(60_000);
    const src = read("src/lib/net/lockstep.ts");
    expect(src).toMatch(/STALL_GIVE_UP_MS/);
    expect(src, "giving up does not tell anyone").toMatch(/partner stopped responding/);
  });

  it("keeps enough history that a repair can still rewind", () => {
    // The give-up window and the record window are related: a repair rewinds
    // into the records, so the history has to outlast a plausible stall.
    expect(RECORD_WINDOW_TICKS / 120 * 1000).toBeGreaterThan(1_000);
  });
});

describe("two phones must be set up to play the same game", () => {
  it("hashes the same set the same way whatever order it was built in", () => {
    const a = { fenceSpeed: 1.25, lockThreshold: 12, freeze: 0 };
    const b = { freeze: 0, lockThreshold: 12, fenceSpeed: 1.25 };
    expect(modifierHash(b)).toBe(modifierHash(a));
  });

  it("notices an unlock one player has and the other does not", () => {
    const plain = { ...plainModifiers() } as unknown as Record<string, unknown>;
    const withCert = { ...plain, instantFencesPerMap: 1 };
    expect(modifierHash(withCert)).not.toBe(modifierHash(plain));
  });

  it("does not fail a pairing over the last bit of a percentage", () => {
    // These are derived from multiplications, so two devices can land a
    // vanishing distance apart on a value neither player could perceive.
    const a = { fenceSpeed: 1.2500000001 };
    const b = { fenceSpeed: 1.25 };
    expect(modifierHash(a)).toBe(modifierHash(b));
  });

  it("refuses the map rather than repairing for ever", () => {
    const index = read("src/pages/Index.tsx");
    expect(index, "a mismatch never reaches the player").toMatch(/modifierMismatch/);
    expect(index).toMatch(/PairMismatchNotice/);
  });
});

describe("a pair run does not take over the solo ladder", () => {
  it("marks the run ineligible as it starts", () => {
    const index = read("src/pages/Index.tsx");
    expect(index, "a pair run still files on the solo ledger").toMatch(/markRunIneligible\(\)/);
    const session = read("src/hooks/useGameSession.ts");
    // Armed at the start, not at banking time: by then the run is over and a
    // missed call is a record that should not exist.
    expect(session).toMatch(/markRunIneligible/);
    expect(session, "the ledger does not honour the flag")
      .toMatch(/if \(!recordEligibleRef\.current/);
  });
});

describe("Nearby cannot be raced into two connections", () => {
  it("keeps the first offer and guards the accept", () => {
    const src = read("src/components/game/PairLobby.tsx");
    expect(src, "a second offer replaces the first").toMatch(/setToken\(prev => prev \?\? e\)/);
    expect(src, "the accept can be tapped twice").toMatch(/disabled=\{accepting\}/);
  });
});
