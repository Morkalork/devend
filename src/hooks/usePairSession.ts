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
  /** Host only: take the saved run, or start a new one. */
  chooseContinue: () => void;
  chooseNew: () => void;
  /** Store the run at the start of each map, on both phones. */
  recordMap: (run: RunSave) => void;
  /** Tear the pair down (the player left, or the link died for good). */
  end: () => void;
}

const IDLE: Omit<PairSession, "chooseContinue" | "chooseNew" | "recordMap" | "end"> = {
  phase: "idle", localPlayer: 0, isHost: true, remoteName: "",
  pairId: null, offeredSave: null, runState: null, session: null,
};

export function usePairSession(paired: PairedSession | null) {
  const [state, setState] = useState(IDLE);
  const sessionRef = useRef<LockstepSession | null>(null);
  const transportRef = useRef<Transport | null>(null);
  const runIdRef = useRef<string>("");
  const pairSave = usePairRunSave();
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
          onClose: () => setState(s => ({ ...s, phase: "ended" })),
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

  // ── The host's decision ──────────────────────────────────────────────────

  const start = useCallback((run: RunSave | null, resumed: boolean) => {
    const pairId = state.pairId;
    if (!pairId) return;
    const runId = resumed && run
      ? (pairSave.saveFor(pairId)?.runId ?? `${pairId}-${Date.now()}`)
      : `${pairId}-${Date.now()}`;
    runIdRef.current = runId;
    const seed = `coop:${pairId}:${runId}`;
    const rs: PairRunState = { seed, run, resumed };
    setRunSeedText(seed);
    transportRef.current?.send({ t: "runState", payload: rs });
    setState(s => ({ ...s, runState: rs, phase: "playing" }));
  }, [state.pairId, pairSave]);

  const chooseContinue = useCallback(() => {
    const pairId = state.pairId;
    if (!pairId) return;
    const mine = state.offeredSave?.mine ?? null;
    const theirs = state.offeredSave?.theirs ?? null;
    const pick = chooseSave(mine, theirs);
    if (pick === "none") { start(null, false); return; }
    if (pick === "mine") {
      start(pairSave.saveFor(pairId)?.run ?? null, true);
      return;
    }
    // The partner has the copy worth keeping. Ask for it: a pair save lives on
    // both phones precisely so one of them clearing its data does not end the
    // run for the other.
    transportRef.current?.send({ t: "hostChoice", choice: "sendSave" });
  }, [state.pairId, state.offeredSave, pairSave, start]);

  const chooseNew = useCallback(() => {
    pairSave.discard();
    transportRef.current?.send({ t: "hostChoice", choice: "discardSave" });
    start(null, false);
  }, [pairSave, start]);

  const recordMap = useCallback((run: RunSave) => {
    const pairId = state.pairId;
    const devices = devicesRef.current;
    const seed = state.runState?.seed;
    if (!pairId || !devices || !seed) return;
    pairSave.store(
      { pairId, runId: runIdRef.current || `${pairId}-0`, seed, devices },
      run,
    );
  }, [state.pairId, state.runState, pairSave]);

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
    end,
    /** For the loop: the live session, read fresh each frame. */
    lockstep: useCallback(() => sessionRef.current, []),
  } satisfies PairSession & { lockstep: () => LockstepSession | null };
}

/** Re-exported so callers do not have to know which file it came from. */
export type { PairRunSave };
