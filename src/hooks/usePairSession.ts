/**
 * usePairSession — what a run looks like when two people are in it
 * (TWO_PLAYER_PLAN.md steps 5, 6 and 6b).
 *
 * The lobby hands this hook a live link. From there it owns four things:
 *
 *   1. the lockstep session, which the game loop drives its ticks from;
 *   2. the local player number, so this device's commands are stamped with it;
 *   3. the run state, which the HOST owns: it sends the level index, the
 *      upgrades, the lives and the seed, and the guest adopts them, because
 *      two devices computing their own modifiers would be two different games
 *      with the same board;
 *   4. the pair save, kept on both phones, and the Continue-or-New choice that
 *      opens a returning pair's evening.
 *
 * Why the host decides and the guest follows, rather than both voting: every
 * between-map screen (the shop, the push prompt, the continue prompt) is a
 * decision about ONE run, and a run cannot be in two states. Making the host
 * the single owner is what keeps step 6 small; the guest sees the same screens,
 * read only, with the host's choice landing live.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { LockstepSession } from "@/lib/net/lockstep";
import { modifierHash } from "@/lib/net/stateHash";
import { setCommandSink, setLocalPlayer, type GameCommand, type PlayerId } from "@/lib/net/commands";
import { setRunSeedText } from "@/lib/runRng";
import type { NetMessage, Transport } from "@/lib/net/transport";
import type { PairedSession } from "@/components/game/PairLobby";
import { getDeviceId, pairIdFor } from "@/lib/net/deviceId";
import { chooseSave, usePairRunSave, type PairRunSave, type PairSaveOffer } from "@/hooks/usePairRunSave";
import type { RunSave } from "@/hooks/useRunSave";

/** What the two devices are doing right now. */
export type PairPhase =
  | "idle"          // no pair
  | "deciding"      // connected, choosing Continue or New
  | "playing"
  | "reconnecting"
  | "ended";

export interface PairRunState {
  seed: string;
  /** The solo run record, shipped whole. The guest adopts it. */
  run: RunSave | null;
  /** True when this is a resumed run rather than a fresh one. */
  resumed: boolean;
}

export interface PairSession {
  phase: PairPhase;
  /** 0 on the host, 1 on the guest. */
  localPlayer: PlayerId;
  isHost: boolean;
  remoteName: string;
  /** Stable name for this pair, the same from either phone. */
  pairId: string | null;
  /** The saved run either phone holds for this pair, once both have reported. */
  offeredSave: { mine: PairSaveOffer | null; theirs: PairSaveOffer | null } | null;
  /** The run the two agreed on, once the host has chosen. */
  runState: PairRunState | null;
  /** Handed to the game loop; null when not playing as a pair. */
  session: LockstepSession | null;
  /** True while the lockstep is waiting on the other device. */
  stalled: boolean;
  /** True once the link is gone and will not come back by itself. */
  dropped: boolean;
  /**
   * Set when the two devices are about to play a map under different
   * modifiers, which means one player holds an unlock the other does not.
   *
   * Refusing to start is the whole point. The alternative is two boards that
   * look identical for a second and then behave differently, which the hashes
   * would report as a desync and repair for ever, because the cause is not on
   * the board at all.
   */
  modifierMismatch: boolean;
  /** Declare what this device is about to play under, at each map start. */
  declareModifiers: (level: number, modifiers: Record<string, unknown>) => void;
  /** Host only: take the saved run, or start a new one. */
  chooseContinue: () => void;
  chooseNew: () => void;
  /**
   * Called at the start of each map on both phones.
   *
   * The host publishes its run and both phones save it. The guest does not
   * publish: it has nothing to say about a run it does not own.
   */
  recordMap: (run: RunSave) => void;
  /**
   * The host's run, newest first, for the guest to adopt.
   *
   * Bumped on every map, so the guest can tell a fresh publication from the
   * one it already took. Null on the host, which is already playing its own.
   */
  adopt: { run: RunSave; at: number } | null;
  /** Tear the pair down (the player left, or the link died for good). */
  end: () => void;
}

const IDLE: Omit<PairSession,
  "chooseContinue" | "chooseNew" | "recordMap" | "declareModifiers" | "end"> = {
  phase: "idle", localPlayer: 0, isHost: true, remoteName: "",
  pairId: null, offeredSave: null, runState: null, session: null,
  stalled: false, dropped: false, adopt: null, modifierMismatch: false,
};

export function usePairSession(paired: PairedSession | null) {
  const [state, setState] = useState(IDLE);
  const sessionRef = useRef<LockstepSession | null>(null);
  const transportRef = useRef<Transport | null>(null);
  const runIdRef = useRef<string>("");
  const pairSave = usePairRunSave();
  // The save's FUNCTIONS are stable (useCallback with no deps); the object
  // holding them is new on every render. Callbacks below depend on the
  // functions, never the object: recordMap depending on the object made it a
  // new function every render, and Index's once-per-map publish effect, keyed
  // on it, fired on every render instead. The host re-sent its run in a loop
  // and the guest re-adopted it each time, which rebuilt her modifiers and
  // re-armed the map's Acceptance Criteria after every tap.
  const { saveFor, store: storeSave, discard: discardSave } = pairSave;
  const devicesRef = useRef<[string, string] | null>(null);

  // ── Setting up ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!paired) return;
    let disposed = false;

    (async () => {
      const myDevice = await getDeviceId();
      if (disposed) return;
      const pairId = pairIdFor(myDevice, paired.remoteDeviceId);
      devicesRef.current = [myDevice, paired.remoteDeviceId];

      const session = new LockstepSession({
        transport: paired.transport,
        localPlayer: paired.localPlayer,
        isHost: paired.isHost,
        callbacks: {
          // Dropped, not ended: the run is still there, and the player chooses
          // between pairing again and carrying on alone.
          onClose: () => setState(s => ({ ...s, dropped: true })),
          onStall: (ticks: number) => {
            // A stall of one or two ticks is the ordinary rhythm of a lockstep
            // and saying anything about it would be noise. Past a tenth of a
            // second the board has visibly stopped, and silence reads as a
            // crash.
            if (ticks === 12) setState(s => (s.stalled ? s : { ...s, stalled: true }));
          },
          onHostMessage: (msg: NetMessage) => handleMessage(msg),
        },
      });
      sessionRef.current = session;
      transportRef.current = paired.transport;

      // From here, every command this device's fingers produce is booked by
      // the lockstep instead of landing on the local queue.
      setLocalPlayer(paired.localPlayer);
      setCommandSink((cmd: GameCommand) => session.submit(cmd));

      // Tell the other phone what this one is holding, so the choice can be
      // offered with both answers in hand.
      const mine = pairSave.offerFor(pairId);
      paired.transport.send({
        t: "hostChoice",
        choice: "saveOffer",
        payload: mine,
      });

      setState({
        stalled: false,
        dropped: false,
        adopt: null,
        modifierMismatch: false,
        phase: "deciding",
        localPlayer: paired.localPlayer,
        isHost: paired.isHost,
        remoteName: paired.remoteName,
        pairId,
        offeredSave: { mine, theirs: null },
        runState: null,
        session,
      });
    })();

    const handleMessage = (msg: NetMessage) => {
      if (msg.t === "hostChoice" && msg.choice === "saveOffer") {
        setState(s => ({
          ...s,
          offeredSave: { mine: s.offeredSave?.mine ?? null, theirs: (msg.payload ?? null) as PairSaveOffer | null },
        }));
        return;
      }
      // The host has no save for this pair, or a staler one, and has asked
      // for this phone's copy. A pair save lives on both phones precisely so
      // one of them clearing its data does not end the run for the other, and
      // this is the half of that which actually moves it across.
      if (msg.t === "hostChoice" && msg.choice === "sendSave") {
        setState(s => {
          const record = s.pairId ? pairSave.saveFor(s.pairId) : null;
          if (record) {
            transportRef.current?.send({
              t: "hostChoice", choice: "saveRecord", payload: record,
            });
          }
          return s;
        });
        return;
      }
      // The host's copy, coming the other way. Adopt it whole: the host is the
      // single owner of run state, so there is nothing here to merge.
      if (msg.t === "hostChoice" && msg.choice === "saveRecord") {
        const record = msg.payload as PairRunSave;
        pairSave.adopt(record);
        if (paired.isHost) {
          runIdRef.current = record.runId;
          setRunSeedText(record.seed);
          const rs: PairRunState = { seed: record.seed, run: record.run, resumed: true };
          transportRef.current?.send({ t: "runState", payload: rs });
          setState(s => ({ ...s, runState: rs, phase: "playing" }));
        }
        return;
      }
      // New game: both phones let go of the old one at the same moment, so a
      // reconnect cannot offer a run one of them has already discarded.
      if (msg.t === "hostChoice" && msg.choice === "discardSave") {
        pairSave.discard();
        return;
      }
      // The host's run at the start of a map. Adopting it wholesale is what
      // keeps the two devices playing the SAME run rather than two runs from
      // one seed: whatever this phone's own shop or drafts did in between is
      // overwritten, because the host owns the run and this device is
      // mirroring it.
      if (msg.t === "hostChoice" && msg.choice === "mapState") {
        const run = msg.payload as RunSave;
        setState(s => ({ ...s, adopt: { run, at: Date.now() } }));
        return;
      }
      // What the other phone is about to play under. Compared against this
      // one's; a difference stops the map rather than starting a game neither
      // device is really playing.
      if (msg.t === "modifiers") {
        theirModifiersRef.current = msg;
        compareModifiers();
        return;
      }
      if (msg.t === "runState") {
        // The guest takes the host's run whole. Arming the seed here rather
        // than at map start is deliberate: the board, the shop and the mutator
        // are all dealt from it, and the guest must be holding it before any
        // of that happens.
        const rs = msg.payload as PairRunState;
        setRunSeedText(rs.seed);
        setState(s => ({ ...s, runState: rs, phase: "playing" }));
        return;
      }
    };

    return () => {
      disposed = true;
      setCommandSink(null);
      setLocalPlayer(0);
      sessionRef.current?.close();
      sessionRef.current = null;
      transportRef.current = null;
    };
    // pairSave's functions are stable (useCallback with no deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paired]);

  // ── Modifier agreement ───────────────────────────────────────────────────

  const myModifiersRef = useRef<{ level: number; hash: string } | null>(null);
  const theirModifiersRef = useRef<{ level: number; hash: string } | null>(null);

  const compareModifiers = useCallback(() => {
    const mine = myModifiersRef.current;
    const theirs = theirModifiersRef.current;
    // Only meaningful once both have spoken ABOUT THE SAME MAP: during a map
    // change one side is a level ahead for a moment, and a hash from two
    // different maps is not a disagreement.
    if (!mine || !theirs || mine.level !== theirs.level) return;
    const same = mine.hash === theirs.hash;
    setState(s => (s.modifierMismatch === !same ? s : { ...s, modifierMismatch: !same }));
  }, []);

  const declareModifiers = useCallback((level: number, modifiers: Record<string, unknown>) => {
    const entry = { level, hash: modifierHash(modifiers) };
    myModifiersRef.current = entry;
    transportRef.current?.send({ t: "modifiers", level, hash: entry.hash });
    compareModifiers();
  }, [compareModifiers]);

  // ── The host's decision ──────────────────────────────────────────────────

  const start = useCallback((run: RunSave | null, resumed: boolean) => {
    const pairId = state.pairId;
    if (!pairId) return;
    const runId = resumed && run
      ? (saveFor(pairId)?.runId ?? `${pairId}-${Date.now()}`)
      : `${pairId}-${Date.now()}`;
    runIdRef.current = runId;
    const seed = `coop:${pairId}:${runId}`;
    const rs: PairRunState = { seed, run, resumed };
    setRunSeedText(seed);
    transportRef.current?.send({ t: "runState", payload: rs });
    setState(s => ({ ...s, runState: rs, phase: "playing" }));
  }, [state.pairId, saveFor]);

  const chooseContinue = useCallback(() => {
    const pairId = state.pairId;
    if (!pairId) return;
    const mine = state.offeredSave?.mine ?? null;
    const theirs = state.offeredSave?.theirs ?? null;
    const pick = chooseSave(mine, theirs);
    if (pick === "none") { start(null, false); return; }
    if (pick === "mine") {
      start(saveFor(pairId)?.run ?? null, true);
      return;
    }
    // The partner has the copy worth keeping. Ask for it: a pair save lives on
    // both phones precisely so one of them clearing its data does not end the
    // run for the other.
    transportRef.current?.send({ t: "hostChoice", choice: "sendSave" });
  }, [state.pairId, state.offeredSave, saveFor, start]);

  const chooseNew = useCallback(() => {
    discardSave();
    transportRef.current?.send({ t: "hostChoice", choice: "discardSave" });
    start(null, false);
  }, [discardSave, start]);

  const recordMap = useCallback((run: RunSave) => {
    const pairId = state.pairId;
    const devices = devicesRef.current;
    const seed = state.runState?.seed;
    if (!pairId || !devices || !seed) return;
    storeSave(
      { pairId, runId: runIdRef.current || `${pairId}-0`, seed, devices },
      run,
    );
    // Only the host publishes. The guest saving its own idea of the run would
    // be saving a guess, and on the next reconnect that guess could win the
    // "further along" comparison against the real thing.
    if (state.isHost) {
      transportRef.current?.send({ t: "hostChoice", choice: "mapState", payload: run });
    }
  }, [state.pairId, state.runState, state.isHost, storeSave]);

  /**
   * Clear the stall flag once the pair is moving again.
   *
   * Polled rather than pushed: the lockstep announces a stall as it starts
   * (it is the thing that noticed) but a stall ENDS by a tick simply running,
   * and threading a callback through that path would put a React setState in
   * the physics loop.
   */
  useEffect(() => {
    if (!state.stalled) return;
    const timer = setInterval(() => {
      const live = sessionRef.current;
      if (live && !live.isStalled) setState(s => ({ ...s, stalled: false }));
    }, 120);
    return () => clearInterval(timer);
  }, [state.stalled]);

  /** Drop the pair but keep playing: the partner is not coming back. */
  const continueSolo = useCallback(() => {
    setCommandSink(null);
    setLocalPlayer(0);
    sessionRef.current?.close();
    sessionRef.current = null;
    setState(s => ({ ...s, phase: "playing", session: null, dropped: false, stalled: false }));
  }, []);

  const end = useCallback(() => {
    setCommandSink(null);
    setLocalPlayer(0);
    setRunSeedText(null);
    sessionRef.current?.close();
    sessionRef.current = null;
    setState(IDLE);
  }, []);

  return {
    ...state,
    chooseContinue,
    chooseNew,
    recordMap,
    declareModifiers,
    continueSolo,
    end,
    /** For the loop: the live session, read fresh each frame. */
    lockstep: useCallback(() => sessionRef.current, []),
  } satisfies PairSession & {
    lockstep: () => LockstepSession | null;
    continueSolo: () => void;
  };
}

/** Re-exported so callers do not have to know which file it came from. */
export type { PairRunSave };
