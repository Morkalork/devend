/**
 * lockstep — running one simulation on two devices (TWO_PLAYER_PLAN.md step 4).
 *
 * The contract is short: tick N runs only when BOTH players' commands for tick
 * N are known. Each side sends its own commands stamped with a tick a fixed
 * delay ahead of the one it is running, which buys the network that many ticks
 * to deliver them. An empty tick is still a message, so silence means "nothing
 * happened" rather than "not here yet" - the single most common way a lockstep
 * hangs is treating those two the same.
 *
 * What this does NOT do: predict, roll back, or interpolate the other player.
 * A fence takes seconds to grow and a phone across the table is a few
 * milliseconds away, so the honest version (wait for both, then step) is also
 * the version that feels right. When the remote is late the local sim stalls,
 * which is a stutter; it is never a divergence.
 *
 * Desync is assumed to be possible rather than designed away. Every
 * HASH_EVERY ticks both sides swap a motion hash and a topology hash, and a
 * disagreement escalates in three steps: adopt the host's motion, replay from
 * the seed, restart the map. All three are visible in the admin rig, because a
 * recovery nobody can watch is a recovery nobody trusts.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { GameCommand, PlayerId, CommandDeps } from "./commands";
import { queueLocally } from "./commands";
import type { NetMessage, Transport } from "./transport";
import {
  motionHash, topologyHash, captureMotion, applyMotion, type MotionSnapshot,
} from "./stateHash";

/** Bumped when the wire format changes. A mismatch refuses the pairing. */
export const PROTOCOL_VERSION = 1;

/** How often the two sides compare notes, in ticks (120 ticks = 1s). */
export const HASH_EVERY = 30;

/** Input delay bounds, in ticks. Six ticks is 50ms; 24 is 200ms, which is the
 *  worst a Nearby link should be before its Wi-Fi upgrade lands. */
export const MIN_DELAY_TICKS = 6;
export const MAX_DELAY_TICKS = 24;

/**
 * How many ticks of command history to keep.
 *
 * A repair rewinds the guest to the tick the host's snapshot was taken at and
 * replays forward from there, so the records for those ticks have to still
 * exist. Two seconds is far more than a same-room round trip needs and costs a
 * few kilobytes.
 */
export const RECORD_WINDOW_TICKS = 240;

/**
 * How long a stall may last before the link is treated as gone.
 *
 * A phone that locks its screen or goes to the home screen stops getting
 * animation frames, so it stops sending ticks, and nothing about the socket
 * says so: it is still open, and the partner waits on a device that has no
 * intention of answering. Without this the other player sits on "Waiting for"
 * for ever.
 *
 * Twelve seconds, because a pocketed phone should end the pair but a tunnel, a
 * notification shade or a garbage-collection pause should not.
 */
export const STALL_GIVE_UP_MS = 12_000;

export type DesyncStage = "motion" | "replay" | "restart";

export interface LockstepCallbacks {
  /** Tell the player the link is waiting on the other phone. */
  onStall?: (waitingTicks: number) => void;
  /** A desync was caught and is being repaired at this stage. */
  onDesync?: (stage: DesyncStage, tick: number) => void;
  /** The last resort: both devices restart this map from the shared seed. */
  onRestartMap?: () => void;
  /** The link dropped. The map pauses on this. */
  onClose?: (reason: string) => void;
  /** Whatever the host sends that is not simulation (step 6). */
  onHostMessage?: (msg: NetMessage) => void;
}

export interface LockstepOptions {
  transport: Transport;
  /** Which player this device is. The host is 0. */
  localPlayer: PlayerId;
  /** Only the host answers a desync with its own board. */
  isHost: boolean;
  callbacks?: LockstepCallbacks;
}

interface TickRecord {
  /** Commands per player, absent until that player's message arrives. */
  cmds: (GameCommand[] | undefined)[];
}

export class LockstepSession {
  /** The next tick the simulation will run. */
  private tick = 0;
  /** Commands the local player has produced for a tick not yet sent. */
  private outbox: GameCommand[] = [];
  private records = new Map<number, TickRecord>();
  /** Hashes this side computed, kept until the other side's arrive. */
  private mine = new Map<number, { motion: string; topology: string }>();
  private theirs = new Map<number, { motion: string; topology: string }>();
  private stalledFor = 0;
  private closed = false;
  private lastSentTick = -1;
  /** The guest stops stepping between spotting a drift and being handed the
   *  host's board, so it does not run further on a board it knows is wrong. */
  private awaitingResync = false;
  /** Wall-clock start of the current stall, for the give-up above. Real time,
   *  not sim time: sim time is exactly what stops advancing during one. */
  private stallStartedAt: number | null = null;

  readonly localPlayer: PlayerId;
  readonly remotePlayer: PlayerId;
  readonly isHost: boolean;
  private transport: Transport;
  private cb: LockstepCallbacks;

  /** How far ahead commands are booked. Adapts to the measured round trip. */
  delayTicks = MIN_DELAY_TICKS;

  /** Counters the admin rig reads. */
  readonly stats = { ticksRun: 0, stalls: 0, desyncs: 0, resyncs: 0, restarts: 0 };

  constructor(opts: LockstepOptions) {
    this.transport = opts.transport;
    this.localPlayer = opts.localPlayer;
    this.remotePlayer = (opts.localPlayer === 0 ? 1 : 0) as PlayerId;
    this.isHost = opts.isHost;
    this.cb = opts.callbacks ?? {};
    this.transport.onMessage(m => this.receive(m));
    this.transport.onClose(r => { this.closed = true; this.cb.onClose?.(r); });
  }

  get currentTick(): number { return this.tick; }
  get isStalled(): boolean { return this.stalledFor > 0 || this.awaitingResync; }

  /**
   * Queue a local command. It is booked for a tick `delayTicks` in the future,
   * which is the whole of the trick: by the time that tick comes round the
   * other device has had that long to hear about it.
   */
  submit(cmd: GameCommand): void {
    this.outbox.push(cmd);
  }

  /**
   * Prepare for a frame: absorb any repair, re-measure the link, and say
   * whether this device may step at all.
   *
   * Called once per frame, before the step loop. False means this device is
   * waiting to be put back on the host's board, and the caller should draw
   * what it has and try again next frame.
   */
  beginFrame(game: CanvasGameState): boolean {
    if (this.closed) return false;
    this.adaptDelay();
    // A repair first: it rewinds this device to the host's tick, and running a
    // tick before absorbing it only takes it further from the board it is
    // about to adopt.
    this.absorbResync(game);
    if (this.awaitingResync) {
      // Keep sending while waiting, or the host stalls behind a guest that has
      // gone quiet precisely because it is waiting to be repaired.
      this.sendUpTo(this.tick + this.delayTicks);
      return false;
    }
    return true;
  }

  /**
   * Hand one tick's commands to the game, if both players' are in.
   *
   * False means the other device has not sent yet; the caller steps nothing
   * and draws the frame it has. This is the stall the design promises: never a
   * divergence, only a wait.
   */
  tryReleaseTick(game: CanvasGameState): boolean {
    if (this.closed || this.awaitingResync) return false;

    // Always send this tick's outbox before asking whether we may run it: the
    // other side is waiting on exactly this message, and a session that sent
    // only when it was about to step would deadlock against itself.
    this.sendUpTo(this.tick + this.delayTicks);

    const record = this.records.get(this.tick);
    const remote = record?.cmds[this.remotePlayer];
    const local = record?.cmds[this.localPlayer];
    if (!remote || !local) {
      this.stalledFor++;
      if (this.stalledFor === 1) {
        this.stats.stalls++;
        this.stallStartedAt = Date.now();
      }
      this.cb.onStall?.(this.stalledFor);
      if (this.stallStartedAt !== null && Date.now() - this.stallStartedAt > STALL_GIVE_UP_MS) {
        // Gone, not slow. Ending it here is what lets the other player choose
        // between pairing again and carrying on alone, instead of watching a
        // spinner for a phone that is in a pocket.
        this.closed = true;
        this.cb.onClose?.("partner stopped responding");
      }
      return false;
    }
    this.stalledFor = 0;
    this.stallStartedAt = null;

    // Player order, always, so both devices apply a simultaneous pair the same
    // way round. Two cuts landing on the same tick is rare and exactly the
    // case that must not be settled by who happened to arrive first.
    for (const cmd of local.concat(remote).sort((a, b) => a.player - b.player)) {
      queueLocally(game, cmd);
    }
    return true;
  }

  /** Called after the caller has stepped the tick tryReleaseTick released. */
  endTick(game: CanvasGameState): void {
    // The record is KEPT, not deleted: a repair rewinds to the host's tick and
    // replays forward, which needs the commands for the ticks in between.
    this.tick++;
    this.pruneRecords();
    this.stats.ticksRun++;
    if (this.tick % HASH_EVERY === 0) this.exchangeHash(game);
    this.checkAgreement(game);
  }

  /**
   * Run up to `budget` ticks. A convenience wrapper over the three calls
   * above, for the headless bench and the admin rig; the real game loop drives
   * them itself, because its step is spread across an accumulator.
   */
  run(
    game: CanvasGameState,
    budget: number,
    step: (game: CanvasGameState) => void,
    deps: CommandDeps,
  ): number {
    if (!this.beginFrame(game)) return 0;
    let ran = 0;
    while (ran < budget) {
      if (!this.tryReleaseTick(game)) break;
      step(game);
      this.endTick(game);
      ran++;
      if (this.awaitingResync) break;
    }
    // The deps are the caller's; the step function drains the queue, so
    // nothing here applies a command itself.
    void deps;
    return ran;
  }

  private pruneRecords(): void {
    const floor = this.tick - RECORD_WINDOW_TICKS;
    if (floor < 0) return;
    for (const k of this.records.keys()) if (k < floor) this.records.delete(k);
  }

  /**
   * Take the host's board, and rewind to the tick it was taken at.
   *
   * The snapshot describes the host at tick H. By the time it lands, this
   * device is somewhere at or past H. Adopting the positions without moving the
   * tick back would paste a stale board onto a later moment, which was the
   * first version of this and which the tests caught: the hashes still
   * disagreed afterwards. So the tick, the clock and the dice all go back to H,
   * and the ticks from H forward are replayed out of the record window.
   */
  private absorbResync(game: CanvasGameState): void {
    const snap = this.pendingResync;
    if (!snap) return;
    this.pendingResync = null;
    this.awaitingResync = false;
    if (!this.records.has(snap.tick) && snap.tick < this.tick) {
      // The window did not reach back far enough. Nothing here can put the two
      // boards together again; the map restarts from the shared seed.
      this.stats.restarts++;
      this.cb.onDesync?.("restart", this.tick);
      this.cb.onRestartMap?.();
      return;
    }
    if (!applyMotion(game, snap)) {
      this.stats.restarts++;
      this.cb.onDesync?.("restart", this.tick);
      this.cb.onRestartMap?.();
      return;
    }
    this.tick = snap.tick;
    // Hashes either side of the rewind are about two different boards, so they
    // cannot be compared with each other.
    this.mine.clear();
    this.theirs.clear();
    this.stats.resyncs++;
  }

  /** Send every tick message up to and including `through`. */
  private sendUpTo(through: number): void {
    for (let t = this.lastSentTick + 1; t <= through; t++) {
      const cmds = t === this.tick + this.delayTicks ? this.outbox : [];
      if (t === this.tick + this.delayTicks) this.outbox = [];
      const stamped = cmds.map(c => ({ ...c, player: this.localPlayer }));
      this.record(t).cmds[this.localPlayer] = stamped;
      this.transport.send({ t: "tick", tick: t, cmds: stamped });
      this.lastSentTick = t;
    }
  }

  private record(tick: number): TickRecord {
    let r = this.records.get(tick);
    if (!r) { r = { cmds: [] }; this.records.set(tick, r); }
    return r;
  }

  private receive(msg: NetMessage): void {
    switch (msg.t) {
      case "tick":
        // A duplicate is harmless; the first copy wins so a re-send cannot
        // replace commands already applied.
        if (this.record(msg.tick).cmds[this.remotePlayer] === undefined) {
          this.record(msg.tick).cmds[this.remotePlayer] = msg.cmds;
        }
        break;
      case "hash":
        this.theirs.set(msg.tick, { motion: msg.motion, topology: msg.topology });
        break;
      case "resync":
        this.pendingResync = msg.snapshot as MotionSnapshot;
        this.awaitingResync = false;
        break;
      default:
        this.cb.onHostMessage?.(msg);
    }
  }

  private pendingResync: MotionSnapshot | null = null;

  private exchangeHash(game: CanvasGameState): void {
    const h = { motion: motionHash(game), topology: topologyHash(game) };
    this.mine.set(this.tick, h);
    this.transport.send({ t: "hash", tick: this.tick, motion: h.motion, topology: h.topology });
    // Keep the maps from growing without bound on a long map.
    for (const k of this.mine.keys()) if (k < this.tick - HASH_EVERY * 8) this.mine.delete(k);
    for (const k of this.theirs.keys()) if (k < this.tick - HASH_EVERY * 8) this.theirs.delete(k);
  }

  /**
   * Compare the hashes both sides have for the same tick, and repair.
   *
   * The escalation, in order, and why each rung exists:
   *   1. motion differs, topology agrees -> the boards are the same shape and
   *      one has drifted. The host's motion is adopted. Cheap and invisible.
   *   2. topology differs -> the boards are different shapes; patching
   *      positions would only hide it. Replay from the seed (the caller's job,
   *      via onDesync("replay")).
   *   3. still different -> restart the map from the shared seed. Rare, and
   *      honest about it rather than letting two people play two games.
   */
  private checkAgreement(game: CanvasGameState): void {
    for (const [tick, theirs] of this.theirs) {
      const mine = this.mine.get(tick);
      if (!mine) continue;
      this.theirs.delete(tick);
      this.mine.delete(tick);
      if (mine.motion === theirs.motion && mine.topology === theirs.topology) continue;

      this.stats.desyncs++;
      if (mine.topology !== theirs.topology) {
        this.cb.onDesync?.("replay", tick);
        continue;
      }
      this.cb.onDesync?.("motion", tick);
      // Only the host answers, or two devices would each adopt the other's
      // board and swap their disagreement rather than settle it. The snapshot
      // is of NOW, not of the tick the hashes disagreed at: that tick is
      // already behind the host, and "now" is a board it can vouch for.
      if (this.isHost) {
        this.transport.send({
          t: "resync",
          tick: this.tick,
          snapshot: captureMotion(game, this.tick),
        });
      } else {
        // Stop here rather than run further on a board known to be wrong.
        this.awaitingResync = true;
      }
    }
  }

  /**
   * Pick the input delay from the measured round trip.
   *
   * Half a round trip is the one-way time; a tick of slack on top absorbs the
   * jitter, and the whole thing is clamped so a bad measurement cannot make
   * the game unplayable in either direction.
   */
  private adaptDelay(): void {
    const rtt = this.transport.rttMs;
    if (rtt == null) return;
    const oneWayTicks = Math.ceil((rtt / 2) / (1000 / 120));
    const want = oneWayTicks + 2;
    this.delayTicks = Math.max(MIN_DELAY_TICKS, Math.min(MAX_DELAY_TICKS, want));
  }

  close(): void {
    this.closed = true;
    this.transport.close();
  }
}
