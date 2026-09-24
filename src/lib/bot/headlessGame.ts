/**
 * A game you can play without a screen.
 *
 * Every test in this repo so far checks one function against one situation
 * someone thought of. This drives the REAL physics - the same updateBall,
 * updateFenceWallFn and applyCutFn the browser runs - through thousands of
 * frames of actual play, and watches for states nobody thought of.
 *
 * The value is in the second kind of bug. A unit test asks "does this do what I
 * expect"; a bot asks "is there any sequence of legal moves that breaks it",
 * which is the question that finds unwinnable maps, softlocks, and arithmetic
 * that only goes non-finite on the four hundredth frame of a particular seed.
 *
 * ── What this is NOT ───────────────────────────────────────────────────────
 *
 * Not the game loop. useGameLoop owns rendering, timing, React state and the
 * hundred callbacks the UI needs; reproducing it here would be a second copy
 * that drifts. This is the SUBSET that moves the world: the same functions in
 * the same order, stepped at the same fixed PHYSICS_STEP, with the UI
 * callbacks stubbed. If the loop's order changes, this must change with it -
 * which is why the order below is commented against its source.
 */
import { updateLauncherArming } from "@/lib/physics/launcher";
import { dematerializeArmedLaunchers } from "@/lib/physics/launcherShell";
import { updateRubble } from "@/lib/physics/rubble";
import { PHYSICS_STEP } from "@/lib/gameConstants";
import { runtimeDefaults } from "./runtimeDefaults";
import { DEFAULT_SCOPE_CREEP } from "@/lib/scopeCreep";
import { createInitialGameData } from "@/lib/initGame";
import { castRayWithReflections } from "@/lib/wallGeometry";
import { vec2Normalize } from "@/lib/polygon";
import { applyLodestones } from "@/lib/physics/lodestone";
import { updateMoversFn } from "@/lib/physics/updateMovers";
import { collectPhasedOut, tickPhasing } from "@/lib/physics/phasing";
import { updateBall } from "@/lib/physics/updateBall";
import { updateFenceWallFn } from "@/lib/physics/updateFenceWall";
import {
  applyCutFn, checkSpaceWin,
  evaluateWinConditions as evaluateWinConditionsFn,
} from "@/lib/physics/applyCut";
import { processDestroysFn } from "@/lib/physics/destructibles";
import { processWallBreaksFn } from "@/lib/physics/breakFenceWall";
import { tickCharges } from "@/lib/physics/charge";
import { tickDrills } from "@/lib/physics/drill";
import { wallBlocksCutStart } from "@/lib/physics/cutStart";
import { isPositionActive } from "@/lib/spaceGrid";
import { findRegionContainingPoint } from "@/lib/gameUtils";
import type { GameCallbacks } from "@/lib/physics/gameCallbacks";
import type { GrowingWall, Vector2, GameResult } from "@/types/game";
import type { MapFailKind, MapFailure } from "@/lib/mapFailure";
import type { GameMessageId } from "@/lib/gameMessages";
import type { CanvasGameState } from "@/types/gameState";
import type { LevelConfig } from "@/types/level";
import { DEFAULT_MODIFIERS, type GameModifiers } from "@/hooks/useActiveModifiers";
import { collectDeliveries, releaseReservedSpace } from "@/lib/physics/deliveryBox";

import { tickMapBeats } from "@/lib/physics/mapBeats";
import { creepFactor } from "@/lib/scopeCreep";
import { abilitySpeedFactor } from "@/lib/abilityEffects";
import { updateMoverControlFn } from "@/lib/physics/moverControl";
import { tickCages } from "@/lib/physics/cage";
import { clearFreeze } from "@/lib/physics/fenceStrike";
import { updateBallEffects } from "@/lib/ballEffects";
import { handleBallCollisions } from "@/lib/physics/handleBallCollisions";
import { tickChains } from "@/lib/physics/chain";
import { updatePickups } from "@/lib/pickups";
import { assignShardBugs, effectiveBugChance, mapHasBugs, squashBugs, updateBugs } from "@/lib/physics/bugs";
import { authoredBugCarriers } from "@/lib/bugs";
import type { BugConfig } from "@/types/bugs";
import { resolveWinSpec } from "@/lib/winSpec";
import { tickRainbowSpawns } from "@/lib/physics/rainbowSpawner";
import { tickBossPhases, tickBossSpit, tickBossFenceWipe } from "@/lib/physics/bossPhases";
import { mutatorById, mutatorSpeedFactor, selectMapMutator } from "@/lib/mapMutators";
import { getRunRng, getRunSeedText, setRunSeedText } from "@/lib/runRng";
import { normaliseGravity } from "@/lib/physics/gravity";
import { resolveBoardEdges } from "@/lib/physics/boardEdges";
import { advanceSimClock, setSimNow, simNow, SIM_CLOCK_START_MS } from "@/lib/simClock";
import { drainCommands, enqueueCommand } from "@/lib/net/commands";
import { STANDARD_FENCE_ID } from "@/lib/fences";
/**
 * A clock the bot controls.
 *
 * The engine reads SIM time, not wall time (src/lib/simClock.ts): fence growth
 * is `simNow() - wall.startTime`, and the boss leap, the lock glide and the
 * freeze all key off the same clock. In the browser the game loop advances it
 * one physics step per step. Headlessly the bot does, which is what lets a bot
 * step thousands of frames in a few milliseconds of real time and still see a
 * board that changes, and what makes a run independent of how fast the machine
 * is, so a seed reproduces a finding exactly.
 *
 * Before the sim clock existed this monkeypatched `performance.now`. It no
 * longer needs to: the engine reads the clock the harness owns by design
 * rather than by substitution. The three functions keep their names and their
 * contract so every caller reads the same.
 */
let clockInstalled = false;

/** Take over the clock. Must be paired with releaseClock in a finally.
 *  A no-op while a clock is already installed, so nesting cannot rewind it. */
export function installClock(startMs = SIM_CLOCK_START_MS): void {
  if (clockInstalled) return;
  clockInstalled = true;
  setSimNow(startMs);
}

export function releaseClock(): void {
  clockInstalled = false;
}

/** Move the bot's clock forward by `seconds` of simulated time. */
export function advanceClock(seconds: number): void {
  advanceSimClock(seconds * 1000);
}

/** Everything the bot did and everything the game told it, for the report. */
export interface BotEvents {
  levelComplete: boolean;
  gameOver: boolean;
  livesLost: number;
  cutsMade: number;
  locks: number;
  remainingPercent: number;
  /**
   * Why the map ended badly, when it did.
   *
   * The harness used to drop this on the floor: onGameEnd ignored its argument
   * and onMapTimedOut was a no-op, so every bad ending read as a bare `lost`.
   * "The bot lost level 5 five times out of five" and "the bot lost it to a
   * fence five times out of five" are different findings, and only one of them
   * is about the map.
   */
  failKind?: MapFailKind;
  /**
   * Every refusal the game explained, in order.
   *
   * Recorded rather than stubbed because a refusal IS the game telling the
   * player something, and the two that happen when a cut completes are silent
   * on the board without it: the fence draws the whole way across and then
   * vanishes. A harness that dropped these could not tell a cut refused with
   * an explanation from one refused without.
   */
  messages: GameMessageId[];
}

export interface BotGame {
  game: CanvasGameState;
  level: LevelConfig;
  levelNumber: number;
  modifiers: GameModifiers;
  callbacks: GameCallbacks;
  events: BotEvents;
  frames: number;
}

/**
 * Modifiers with everything off, so a run measures the map and not a build.
 *
 * DEFAULT_MODIFIERS rather than a hand-written subset. A partial object does
 * not fail loudly here: `1 + activeModifiers.fenceSpeedPerLock * 0` on a
 * missing key is NaN, which flows into the fence speed, which makes every
 * growth step NaN, and the fence simply never moves. The bot then sits
 * watching a board that cannot change and reports the MAP as unresolvable -
 * a bug in the harness, dressed as a finding about the game.
 */
export function plainModifiers(over: Partial<GameModifiers> = {}): GameModifiers {
  return { ...DEFAULT_MODIFIERS, ...over };
}

/**
 * Callbacks that record instead of rendering.
 *
 * Deliberately not silent no-ops: the callbacks ARE the game telling you what
 * happened, and a bot that ignores them cannot tell a win from a crash. The
 * ones that matter are recorded; the rest are stubs because they drive pixels.
 */
function recordingCallbacks(events: BotEvents): GameCallbacks {
  const noop = () => {};
  return {
    // ── what the game is telling us ──────────────────────────────────────
    setLockedBallsCount: (n: number) => { events.locks = n; },
    setRemainingPercent: (n: number) => { events.remainingPercent = n; },
    onLevelComplete: () => { events.levelComplete = true; },
    onGameEnd: (result: GameResult) => {
      events.gameOver = true;
      events.failKind ??= result.failure?.kind;
    },
    onLivesChange: () => { events.livesLost += 1; },
    onGameMessage: (id: GameMessageId) => { events.messages.push(id); },

    // ── things that only exist to paint ──────────────────────────────────
    // Enumerated rather than proxied on purpose: a Proxy returning a function
    // for any name would let the harness sail past a callback the engine
    // genuinely needs a real answer from, and the bot would report whatever
    // that silence caused as a bug in the game.
    collectAndDrawRemovedSamples: noop,
    repaintRegionCanvas: noop,
    render: noop,
    startDissolve: noop,
    setTutorialCutMade: noop,
    setPushMode: noop,
    setClearedPercent: noop,
    setScreenFlash: noop,
    setIsShaking: noop,
    setIsRecovering: noop,
    setWallShieldCount: noop,
    setDisplayLives: noop,
    setCompletedCuts: noop,
    onMapComplete: noop,
    // The map was lost for ONE life and would restart. The bot has no restart,
    // so this ends its run - but the reason is the whole point of asking.
    onMapTimedOut: (failure: MapFailure) => {
      events.gameOver = true;
      events.failKind ??= failure.kind;
    },
    onTutorialCutSuccess: noop,
    onBossState: noop,
    onChargeArmed: noop,
    onChargeBlown: noop,
    onChestReward: noop,
    onCircuitComplete: noop,
    onFenceBroke: noop,
    onObjectDestroyed: noop,
    onStreamHarvested: noop,

    // ── answers the engine actually branches on ──────────────────────────
    // A lock is only counted if this says yes, and freezeOnComplete false is
    // what lets a finished map finish rather than holding on a frozen board.
    onBallTypeLocked: () => true,
    freezeOnComplete: () => false,
    getLives: () => 3,
    setLivesRef: noop,
    flashTimeoutRef: { current: null },
    shakeTimeoutRef: { current: null },
  } as unknown as GameCallbacks;
}

/** Deal a map, ready to be played. */
/**
 * What weather to deal this board.
 *
 * `"roll"` is what a PLAYER gets: the boss's forced mutator, then the map's own
 * pin, then the procedural roll off the run seed - the same expression, in the
 * same order, that GameScreen uses. runBot asks for it, because a sweep has to
 * play the map the player gets.
 *
 * Anything else holds the weather still: an id pins one, `null` forces a bare
 * board, and OMITTING IT - the default - also gives a bare board.
 *
 * That default is deliberate and was learned the hard way. When the roll landed
 * it was unconditional, and `getRunRng` falls through to `Math.random` when no
 * run seed is armed. Eighteen test files build a board with createBotGame
 * directly and arm no seed, so overnight every one of them at level 11 or above
 * started drawing a random mutator per run - crunch, overclock or none - and
 * the suite grew a flake that took a full-suite repeat to catch. A board dealt
 * by a mechanic test is not a sweep and never wanted weather; a sweep asks for
 * it by name.
 */
export type BotWeather = "roll" | string | null;

export function createBotGame(
  level: LevelConfig, levelNumber: number, modifiers: GameModifiers = plainModifiers(),
  /**
   * `bugs` seeds this board's bug tuning, which is OFF unless a caller asks
   * for it. A ladder sweep has to measure the map, not what a power-up handed
   * the bot on one seed; a test about bugs passes DEFAULT_BUG_CONFIG here and
   * gets a board whose shards carry them exactly as the browser's would.
   */
  opts: { mutator?: BotWeather; bugs?: BugConfig } = {},
): BotGame {
  // A DEAL WITH NO RUN SEED IS A DEAL NOBODY CAN REPRODUCE, so arm one.
  //
  // createInitialGameData takes the map rotation, the variety draw and the ball
  // types from getRunRng, which falls through to Math.random when no seed is
  // armed. Eighteen test files deal a board here and arm nothing, so each of
  // them was getting one of FOUR ROTATIONS at random, every run - which is the
  // flake class the guidelines already describe as having cost two separate
  // ~1-in-4 CI failures, still live, and measured again here at 0,1,2,3 across
  // thirty deals of level 12.
  //
  // The rule those guidelines give ("any test that asserts a coordinate must
  // pin the deal") is sound and has been quietly disobeyed eighteen times,
  // which is the usual fate of a rule that has to be remembered. So the harness
  // pins it instead: no seed armed means this one, and a caller that wants a
  // particular deal arms its own beforehand exactly as runBot does.
  //
  // Deliberately NOT restored afterwards. The seed has to stay armed for the
  // rest of the deal (createInitialGameData reads it below) and for the play
  // that follows, and a test process that ends up deterministic is the outcome
  // being asked for rather than a side effect to tidy away.
  if (getRunSeedText() === null) setRunSeedText("bot-unseeded-deal");

  const mutator = opts.mutator === "roll"
    ? mutatorById(level.boss?.mutator) ?? mutatorById(level.mutator)
      ?? selectMapMutator(levelNumber, getRunRng(`mapMutator:${level.id}`))
    : mutatorById(opts.mutator ?? undefined);

  const events: BotEvents = {
    levelComplete: false, gameOver: false, livesLost: 0,
    cutsMade: 0, locks: 0, remainingPercent: 100, messages: [],
  };
  // The runtime fields first, then the map's own data over the top - the same
  // order GameCanvas builds its gameRef in. createInitialGameData describes a
  // BOARD; the loop also needs the mutable play state (activeWalls, the swipe,
  // the beat trackers) that the component owns.
  const game = {
    ...runtimeDefaults(),
    creepConfig: DEFAULT_SCOPE_CREEP,
    // The map's own pull. Read here rather than left to the caller for the same
    // reason tickMapBeats is ticked in stepBot: a sweep has to play the map the
    // player gets. A gravity map measured without gravity is not a pessimistic
    // reading of that map, it is a reading of a different map.
    // BOTH fields, and that is not belt and braces: `mapGravityActive` reads
    // `mapMutator.behavior === "gravity" && !!gravityConfig`, so a config
    // without the mutator beside it is inert. Set separately they went out of
    // step immediately - the sweep reported a gravity map whose cut counts were
    // identical to the same map with no gravity, which is what gave it away.
    mapMutator: mutator,
    gravityConfig: mutator?.behavior === "gravity"
      ? normaliseGravity(mutator.gravity)
      : null,
    objective: null,
    ...createInitialGameData(level, levelNumber, modifiers),
  } as unknown as CanvasGameState;
  // Same rule GameCanvas applies: a full-gravity map bounces on every side.
  game.boardEdges = resolveBoardEdges(game.boardEdges, mutator?.behavior === "gravity");
  // Shards carrying bugs, decided exactly as the browser decides them. Inert
  // by default, because bugConfig is null unless a test seeds one - the same
  // arrangement the pickups have, so a ladder sweep still measures the map
  // rather than what a power-up happened to hand the bot.
  {
    const cfg = opts.bugs ?? null;
    const authored = authoredBugCarriers(level);
    game.bugConfig = cfg && mapHasBugs(effectiveBugChance(cfg, levelNumber, level.bugChance), authored)
      ? cfg : null;
  }
  if (game.bugConfig) {
    assignShardBugs(
      game.destructibles,
      effectiveBugChance(game.bugConfig, levelNumber, level.bugChance),
      game.bugConfig.maxPerMap,
      authoredBugCarriers(level),
    );
  }
  return {
    game, level, levelNumber, modifiers,
    callbacks: recordingCallbacks(events),
    events, frames: 0,
  };
}

/**
 * One physics frame, in useGameLoop's order.
 *
 * The order is the contract, not a detail: lodestones pull before anything
 * moves so a cluster feels one pull rather than a cascade, and phasing flips
 * solidity BEFORE ball physics so a ball never resolves against an obstacle
 * that is about to stop existing. Both are commented at the loop; both are
 * reproduced here on purpose.
 */
export function stepBot(ctx: BotGame, dt: number = PHYSICS_STEP): void {
  const { game, level, levelNumber, modifiers, callbacks } = ctx;
  if (game.levelComplete || game.gameOver) return;

  // Player actions first, exactly where the loop drains them: at the top of
  // the frame, before anything moves.
  drainCommands(game, { modifiers });

  // Time moves before anything reads it, so a fence started on the previous
  // frame sees a non-zero elapsed on this one.
  advanceClock(dt);
  game.activePlaySeconds = (game.activePlaySeconds ?? 0) + dt;

  // SCOPE CREEP, and everything else that multiplies ball displacement.
  //
  // The single worst divergence this file has had, and the only one that was
  // flattering rather than harsh. `game.creepFactor` multiplies `moveDt` inside
  // updateBall; runtimeDefaults seeds it to 1 and nothing here ever moved it,
  // so EVERY sweep this harness has ever produced was played on a board whose
  // balls never sped up. Scope Creep is +8% a step from 30s, five steps, so a
  // 60-second run finished 24% slower than the real thing and a long one 40%.
  //
  // It also silently disabled two other mechanics that ride the same field: a
  // beat's `speedSpike` (level 17's crunch beat adds 15% and did nothing here)
  // and the crunch/overclock mutators' whole effect on BALLS. The movers felt
  // those mutators, because updateMovers reads mutatorSpeedFactor directly -
  // which is exactly why forcing a mutator appeared to change a sweep and hid
  // the fact that the balls were ignoring it.
  const creepF = creepFactor(game.activePlaySeconds, game.creepConfig);
  game.creepFactor = creepF
    * mutatorSpeedFactor(game.mapMutator, game.lockedBallsCount)
    * abilitySpeedFactor(game)
    * (game.beatSpeedMult || 1);

  for (const ball of game.balls) {
    if (!ball.prevPosition) ball.prevPosition = { x: ball.position.x, y: ball.position.y };
    ball.prevPosition.x = ball.position.x;
    ball.prevPosition.y = ball.position.y;
  }

  // The map's own scripted beats, BEFORE the ball pass so an effect lands on
  // the same frame the threshold is crossed.
  //
  // Missing here for as long as the bot has existed, and it quietly mis-measured
  // the whole ladder. A `breakId` beat force-breaks a slab at a space threshold,
  // which is how a map guarantees its smash clause can always be met - act I
  // maps 5, 6 and 8 all rely on one. The bot never fired them, so it played a
  // harsher map than any player gets and then reported `lockedOut` or
  // `objectiveBuried` on maps that finish perfectly well. Level 13 went from
  // 3 of 8 to its real number on this line alone, with no change to the board.
  tickMapBeats(game, level, levelNumber);

  applyLodestones(game.balls, dt, game.frozenBallId ?? null);
  // Control Freak decides whether the map gets to move a mover at all this
  // step, so it runs before the movers do. Inert for the bot, which never
  // grabs anything - and here because a pass the harness silently omits is how
  // this file has gone wrong four times now.
  updateMoverControlFn(dt, game, simNow());
  updateMoversFn(dt, game);
  tickPhasing(game, game.activePlaySeconds);
  // Cages own their mouths' phase, so this runs beside tickPhasing rather than
  // inside it. Without it a caged ball's mouth never opens and the cage is a
  // solid box: the mechanic ships on one retired map, so no sweep has ever
  // exercised it.
  tickCages(game, simNow());

  // A freeze that outlived its window. In the browser this is a safety net for
  // a setTimeout that got cleared by another path; headlessly there are no
  // timeouts at all, so it is the ONLY thing that ever lifts a freeze - without
  // it a tap-frozen ball stays frozen for the rest of the run.
  if (game.frozenBallId && game.frozenBallReleaseAt !== null
      && simNow() > game.frozenBallReleaseAt) {
    const stranded = game.balls.find(b => b.id === game.frozenBallId);
    if (stranded) {
      if (game.frozenBallVelocity) stranded.velocity = { ...game.frozenBallVelocity };
      if (game.frozenBallPosition) stranded.position = { ...game.frozenBallPosition };
    }
    clearFreeze(game);
  }

  // One set for every ball this step, as the loop does it, rather than
  // recomputed inside updateBall per ball.
  const phasedOut = collectPhasedOut(game);
  for (const ball of game.balls) {
    // A frozen ball does not move and its effects still run. updateBall owns
    // the held-ball decision, but the FROZEN one is the loop's, and skipping it
    // here is what keeps a freeze meaning the same thing in both places.
    if (game.frozenBallId && ball.id === game.frozenBallId) {
      if (game.frozenBallPosition) ball.position = { ...game.frozenBallPosition };
      updateBallEffects(ball.effects, dt, simNow());
      continue;
    }
    updateBall(ball, dt, game, phasedOut);
  }
  // Ball against ball. Missing since this harness was written, so every
  // multi-ball map - which is most of them past level 3 - was swept with the
  // balls passing through one another.
  handleBallCollisions(game);
  // Bugs squash with the ball pass, as in the browser. Inert on a board with no
  // bugConfig, which is every sweep by default - the same arrangement the
  // pickups have, and for the same reason: a ladder measurement has to be of
  // the map, not of what a power-up happened to hand the bot on one seed. A
  // test that wants them seeds game.bugConfig itself.
  squashBugs(game, {
    modifiers,
    cumulativeLockedBalls: 0,
    spec: resolveWinSpec(level, modifiers),
    callbacks,
  });

  // A fired barrel latches armed once its last ball has left, and until then
  // the input layer refuses every cut. The bot honours the same rule (runBot
  // reads fencesBlockedByLauncher), so the latch has to tick here or the bot
  // never cuts on a launcher map at all.
  updateLauncherArming(game);
  // And the frame it arms, the shell comes down and its ground reopens. The
  // loop does the same (settleLaunchers), and the bot has to see the same
  // board: a barrel footprint that reopens in the browser and not here would
  // make every launcher sweep read a different space count from the player.
  dematerializeArmedLaunchers(game, callbacks, simNow());

  // The same slide the browser loop runs. Rubble deflects balls, so a harness
  // that skipped it would have the bot playing a board whose physics differ
  // from the one the player gets.
  updateRubble(game, dt, performance.now());

  // Deliveries: a ball that has crossed a box's membrane is taken out of play
  // and counted. After ball movement so a ball that entered this step counts
  // this step, and before the cut pass so the win sees it.
  for (const ev of collectDeliveries(game)) {
    if (ev.satisfied) releaseReservedSpace(game, ev.box);
  }
  // Chains solve AFTER ball physics so the rope reads the balls' new positions,
  // tethers or snags them, and sweeps fences.
  tickChains(game, dt, simNow());

  // Growing fences, then the cuts any of them just finished. applyCutFn
  // removes the wall itself, so the list is snapshotted exactly as the loop
  // does it.
  for (const wall of [...game.activeWalls]) {
    updateFenceWallFn(dt, game, level, levelNumber, modifiers, 680, 750, 50, callbacks, wall);
  }
  if (!game.levelComplete) {
    for (const wall of [...game.activeWalls]) {
      if (game.levelComplete) break;
      if (wall.isComplete) {
        applyCutFn(wall, game, level, levelNumber, modifiers, false, true, 0, callbacks);
      }
    }
  }
  // ── The three end-of-frame passes useGameLoop runs, in its order ────────
  //
  // These were MISSING, and the gap was invisible because everything they do
  // is a consequence rather than a step: a destructible reached zero hits and
  // was queued, and nothing ever emptied the queue. So in every bot run ever
  // recorded, breaking something had no effect on the world - no space
  // reopened, no stack toppled, no chest paid, no gated area unsealed - while
  // `destroyed` still flipped, so a report could say the bot smashed a slab on
  // a board where smashing a slab did nothing.
  //
  // That is exactly the divergence this file's header warns about: it is the
  // subset of the loop that moves the world, and when the loop's order changes
  // this must change with it. Charges first, because a blast pushes its target
  // onto pendingDestroys and shredded fences onto pendingWallBreaks and both
  // should land the same frame.
  // ── The once-per-frame passes ──────────────────────────────────────────
  //
  // The browser runs these outside the fixed-step loop, once per rAF frame.
  // The bot steps exactly one PHYSICS_STEP per call, so one call IS one frame
  // here - the same cadence a 120Hz device gives the real game - and that is
  // what makes running them at this level faithful rather than double-rated.
  //
  // Pickups expire and roll on the active-play clock.
  updatePickups(game);
  // ...and bugs fly and spawn on the same clock.
  updateBugs(game, dt);
  // The `spawnTimedBalls` bundle, all four of it. Missing entirely, and the
  // boss three are why: a BOSS MAP HAS NEVER BEEN PLAYABLE BY THIS HARNESS.
  // The boss never changed phase, never spat, and never wiped the player's
  // fences, so every boss sweep measured a stationary lump with a big health
  // bar. Rainbow balls never spat their timed adds either, which is the whole
  // reason a rainbow ball exists.
  tickRainbowSpawns(game, levelNumber);
  tickBossPhases(game, level, levelNumber);
  tickBossSpit(game, level);
  tickBossFenceWipe(game, level, () => {
    // The browser clears the fences through a renderer-aware helper; headlessly
    // the board state IS the whole game, so dropping the growing walls is the
    // same act with nothing to repaint.
    game.activeWalls.length = 0;
  });

  tickCharges(game, {});
  // The drill chews here too. The bot never selects one, so this is dead on
  // every sweep today - and it is here anyway, because the harness exists to
  // run the same loop the browser runs, and a pass it silently omits is how
  // three end-of-frame passes came to be missing from it before.
  tickDrills(game, dt);
  if (game.pendingWallBreaks.length > 0) processWallBreaksFn(game, callbacks);
  if (game.pendingDestroys.length > 0) {
    processDestroysFn(game, callbacks, levelNumber, modifiers);
    // The real loop re-checks the win here: a destroy can capture pocket cells
    // and take the remaining space past the goal with no fence involved, and
    // without this the map shows CLEAR and never ends.
    checkSpaceWin(game, level, callbacks, levelNumber, modifiers);
  }

  // The loop's own safety net, and the MAP DEADLINE that rides in it.
  //
  // useGameLoop calls checkWinCondition every active frame, and
  // evaluateWinConditions opens by failing the map once activePlaySeconds has
  // reached getMapTimeLimit. The bot called it only in reaction to a cut or a
  // destroy, so between cuts the clock did not exist: every sweep this harness
  // has ever run played a map with NO TIME LIMIT and reported the result as if
  // it had one. A level-15 seed came back a win at 53.2s on a 50s map, which is
  // how it was found.
  //
  // That is the third time this file has diverged from the loop in the same
  // shape (map beats, the end-of-frame passes, now this), and the header's rule
  // is the one that keeps catching it: the harness exists to run the same loop
  // the browser runs, and a pass it silently omits is a measurement of a
  // different game.
  if (!game.levelComplete && !game.gameOver) {
    evaluateWinConditionsFn(game, level, levelNumber, modifiers, callbacks);
  }

  ctx.frames += 1;
}

/**
 * Start a fence at `origin` heading along `direction`, if the game allows it.
 *
 * Mirrors useGameInput: cast a ray both ways to find where the fence would
 * stop, and build the wall from those waypoints. Returns false when the cut is
 * not legal from here, which is information rather than a failure - a bot that
 * could always cut would never find the states where you cannot.
 */
export function tryCut(ctx: BotGame, origin: Vector2, direction: Vector2): boolean {
  const { game } = ctx;
  if (game.levelComplete || game.gameOver) return false;

  // The same legality chain useGameInput walks, in the same order. A bot that
  // skipped it would happily start fences from inside captured space or through
  // a wall, and every "bug" it reported would be its own.
  if (!game.spaceGrid || !isPositionActive(game.spaceGrid, origin)) return false;
  const region = findRegionContainingPoint(game.regions, origin.x, origin.y);
  if (!region) return false;
  for (const w of game.walls) {
    if (wallBlocksCutStart(origin, w, game.spaceGrid)) return false;
  }

  const dir = vec2Normalize(direction);
  if (!Number.isFinite(dir.x) || !Number.isFinite(dir.y)) return false;
  const neg = { x: -dir.x, y: -dir.y };

  // The rays are cast twice: once here, to answer "is there a cut to make at
  // all", and once by the command, which is the thing that actually makes it.
  // Cheap, and the alternative is the harness owning a second copy of the
  // fence-building code - which is exactly what it used to own, thickness 4
  // and all, on a board whose fences are WALL_THICKNESS wide.
  const forward = castRayWithReflections(origin, dir, game.walls);
  const backward = castRayWithReflections(origin, neg, game.walls);
  if (forward.waypoints.length < 2 || backward.waypoints.length < 2) return false;

  const before = game.activeWalls.length;
  enqueueCommand(game, {
    kind: "cut",
    player: 0,
    start: { ...origin },
    // Any point along the heading will do: the command normalises the drag.
    end: { x: origin.x + dir.x * 100, y: origin.y + dir.y * 100 },
    path: null,
    regionId: region.id,
    fenceTypeId: game.selectedFenceTypeId ?? STANDARD_FENCE_ID,
  });
  drainCommands(game, { modifiers: ctx.modifiers });
  if (game.activeWalls.length === before) return false;   // refused on a breakable anchor
  ctx.events.cutsMade += 1;
  return true;
}
