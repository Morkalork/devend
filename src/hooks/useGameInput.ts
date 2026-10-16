/**
 * useGameInput — attaches pointer event listeners to the game canvas.
 *
 * The handlers operate directly on the mutable CanvasGameState ref; they
 * produce no React state changes except for the two UI setters.
 *
 * Every lift and every second touch is matched to the pointer it belongs to.
 * A phone held in one hand puts more than one finger on the glass, and the
 * board used to let any of them call off, or end, the fence being drawn.
 */

import { useEffect, RefObject } from "react";
import { uiCovers } from "@/ui/hitGate";
import { boardAngleFor } from "@/lib/boardTilt";
import { CanvasGameState } from "@/types/gameState";
import { boardEntityAt, type BoardEntityHit } from "@/lib/boardEntityInfo";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { Ball, GrowingWall, Vector2 } from "@/types/game";
import {
  vec2Sub,
  vec2Length,
  vec2Normalize,
} from "@/lib/polygon";
import { STANDARD_FENCE_ID, getFenceType } from "@/lib/fences";
import { WALL_THICKNESS, castRayWithReflections } from "@/lib/wallGeometry";
import {
  BASE_SWIPE_MIN_DISTANCE,
  FREEZE_COOLDOWN_MULTIPLIER,
  FREEZE_TAP_SLOP,
  SUPERIOR_LOCK_DURATION,
} from "@/lib/gameConstants";
import { fencesBlockedByLauncher } from "@/lib/physics/launcher";
import { loadedSlingAt, slingShape, fireSlingFence } from "@/lib/physics/slingFence";
import { moverAt, railParam, railReading, releaseMover } from "@/lib/physics/moverControl";
import { bugAtTap } from "@/lib/physics/bugs";
import {
  BOARD_WIDTH,
  BOARD_HEIGHT,
  screenToWorld,
  isPointInBoard,
  getDevicePixelRatio,
  VISIBLE_BOARD_FRACTION,
} from "@/lib/boardConstants";
import { isPositionActive } from "@/lib/spaceGrid";
import { wallBlocksCutStart } from "@/lib/physics/cutStart";
import { findRegionContainingPoint } from "@/lib/gameUtils";
import { cutAnchorsBreakable } from "@/lib/physics/destructibles";
import { bentDrawnPath, joinProjection, outgoingDirection, incomingDirection } from "@/lib/physics/bentCut";
import type { GameMessageId } from "@/lib/gameMessages";
import { abilityFenceRushFactor } from "@/lib/abilityEffects";
import { isTappableBall } from "@/lib/ballTypes";
import { initAudio } from "@/lib/gameAudio";
import { enqueueCommand, freezeTargetAt, getLocalPlayer } from "@/lib/net/commands";
import { simNow } from "@/lib/simClock";
import { traceTouch } from "@/lib/touchTrace";

/**
 * The board's current rotation (issue #77), recomputed rather than cached.
 *
 * The renderer derives its angle from the same pure function and the same
 * activePlaySeconds, so the two cannot drift: a tap is always un-turned by
 * exactly the angle the board was drawn at. Caching it on the game state would
 * introduce a frame of skew between what is on screen and where a fence lands.
 */
/**
 * Bent-fence drag sampling (#66). Points closer together than the spacing add
 * nothing the simplifier can use; the cap is a ceiling on a very long slow drag
 * so the buffer cannot grow without bound.
 */
const SWIPE_SAMPLE_SPACING = 12;
const MAX_SWIPE_SAMPLES = 256;

/**
 * Telling a deliberate second finger from the hand holding the phone, in CSS
 * px (see strayReason). The edge band is where wrapped fingertips and a
 * curved screen's rim land; a contact wider than the palm limit is not a
 * fingertip, even pressed hard; and a swipe that has not travelled the hand-off slop is not yet a
 * fence anyone is drawing.
 */
export const EDGE_GRIP_CSS = 24;
export const PALM_CSS = 64;
export const HANDOFF_SLOP_CSS = 16;
/** World units of invisible margin round the drawn board, each side. */
const VISIBLE_INSET = (BOARD_WIDTH * (1 - VISIBLE_BOARD_FRACTION)) / 2;

function boardTilt(game: CanvasGameState): number {
  return boardAngleFor(game.activePlaySeconds, game.gravityConfig, game.boardTilt);
}

/** How many fences may grow at once: 1, plus the additionalConcurrentFences
 *  modifier, plus one while Fence Overclock is active (#38). */
function concurrentFenceLimit(game: CanvasGameState, activeModifiers: GameModifiers): number {
  const extra = Math.max(0, Math.round(activeModifiers.additionalConcurrentFences));
  return 1 + extra + (abilityFenceRushFactor(game) > 1 ? 1 : 0);
}

export function useGameInput(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  gameRef: RefObject<CanvasGameState | null>,
  activeModifiers: GameModifiers,
  setCutCount: (n: number) => void,
  setIsPlayerDragging: (v: boolean) => void,
  setFreezeUsesRemaining: (n: number) => void,
  /** Targeted-ability tap handler (Magnet): consumes the next board tap as the
   *  point. Read from a ref so the listeners can stay wired once. */
  onAbilityTargetRef?: RefObject<((id: string | null, pos: { x: number; y: number } | null) => void) | null>,
  /** Press-and-hold on a superior-lock star: opens the lock explainer. Read from
   *  a ref so the listeners stay wired once. */
  onSuperiorInfoRef?: RefObject<(() => void) | null>,
  /** Tap on a white "tappable" ball (#57): the input layer removes it; this runs
   *  the side effects (pop, ball-count, sound). Read from a ref. */
  onTapRemoveRef?: RefObject<((info: { x: number; y: number; color: string }) => void) | null>,
  /** Press-and-hold on a board object: opens its explainer. Read from a ref so
   *  the listeners stay wired once. */
  onEntityInfoRef?: RefObject<((hit: BoardEntityHit) => void) | null>,
  /**
   * Say why a cut was refused.
   *
   * Every refusal below used to be a bare `return`, or a console.warn the
   * player will never see. From their side the fence simply did not appear,
   * which reads as a bug rather than a rule. Read from a ref so the listeners
   * stay wired once.
   */
  onMessageRef?: RefObject<((id: GameMessageId) => void) | null>,
): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const getCanvasCoords = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      // Derive the CSS→physical ratio from the canvas itself rather than
      // getDevicePixelRatio(): exact under both renderers (the Pixi path runs
      // at native DPR, above the 2D path's capped ratio) and mid-DPR-ramp.
      const dpr = rect.width > 0 ? canvas.width / rect.width : getDevicePixelRatio();
      return { screenX: (e.clientX - rect.left) * dpr, screenY: (e.clientY - rect.top) * dpr };
    };

    // Press-and-hold on a superior-lock star (the persistent gold badge) opens
    // the lock explainer. The star is canvas-drawn, so hit-test the pointer in
    // world space against superior pockets whose star has already faded in.
    const HOLD_MS = 450;                 // matches the standard explainer gesture
    const STAR_HIT_RADIUS = 28;          // world units, generous for touch
    const HOLD_MOVE_SLOP = 12;           // world units; moving past this cancels
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let holdPointerId: number | null = null;
    let holdStartWorld: { x: number; y: number } | null = null;

    /**
     * What THIS device's finger is doing, as opposed to what the game state is
     * doing about it.
     *
     * The two used to be the same thing: a grab wrote game.moverDrag and the
     * move handler read the pointer id back out of it. They cannot be the same
     * thing any more. A grab is now a command, applied at the top of the next
     * frame, and in a pair the game state may be holding the OTHER player's
     * mover; neither tells this device whether its own finger is down. So the
     * pointer layer keeps its own record and the simulation keeps its own.
     */
    let gesture:
      | { kind: "mover"; pointerId: number; moverId: string }
      | { kind: "sling"; pointerId: number }
      | null = null;

    const clearHold = () => {
      if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; }
      holdPointerId = null;
      holdStartWorld = null;
    };

    // Nearest superior-lock star under a world point, or null. Only counts stars
    // that have finished fading in (elapsed >= SUPERIOR_LOCK_DURATION).
    const superiorStarAt = (game: CanvasGameState, world: { x: number; y: number }): boolean => {
      const now = simNow();
      for (const [, flash] of game.assimilations) {
        if (!flash.superior) continue;
        if (now - flash.startTime < SUPERIOR_LOCK_DURATION) continue;
        const dx = world.x - flash.centroid.x;
        const dy = world.y - flash.centroid.y;
        if (dx * dx + dy * dy <= STAR_HIT_RADIUS * STAR_HIT_RADIUS) return true;
      }
      return false;
    };

    /**
     * The fence finger, as this device sees it: where it came down (client
     * px), how far it has wandered from there, and whether it came down where
     * a grip lands. Mirrors game.swipePointerId; the game state holds world
     * points and no idea how far a finger travelled on the glass.
     */
    let swipe: { pointerId: number; startClient: Vector2; travel: number; fromGrip: boolean; downAt: number } | null = null;

    /**
     * A finger that was holding a swipe it never moved, set aside when another
     * finger came down. Whichever of the two moves first is the one drawing;
     * the other was resting (a thumb on the board while holding the phone).
     * See the second-finger block in handlePointerDown.
     */
    let standby: {
      pointerId: number; startClient: Vector2; lastClient: Vector2;
      start: Vector2; current: Vector2; regionId: string; fromGrip: boolean;
    } | null = null;

    const trace = (line: () => string) => traceTouch(line);
    const clientDist = (a: Vector2, b: { clientX: number; clientY: number }) =>
      Math.hypot(b.clientX - a.x, b.clientY - a.y);

    /**
     * Why a touch looks like the hand holding the phone rather than a finger
     * meant for the board, or null if it looks meant.
     *
     * Only ever asked about a SECOND touch: the first one on the glass always
     * counts, because a fence may legitimately start at the very edge (the
     * board runs to within a few px of the side of a portrait phone). It is
     * the second that used to be trusted blindly, and on a phone held in one
     * hand the second touch is usually the grip: the fingertips wrapped round
     * the edge, a curved screen's rim, the heel of the palm. Each of them
     * called off the fence being drawn, with a 30ms buzz the player never
     * noticed, which is exactly "a perfect fence, and nothing happened".
     */
    const strayReason = (e: PointerEvent, game: CanvasGameState): string | null => {
      const vw = document.documentElement.clientWidth || window.innerWidth;
      if (e.clientX < EDGE_GRIP_CSS || e.clientX > vw - EDGE_GRIP_CSS) return "screen edge";
      if (e.pointerType === "touch" && Math.max(e.width, e.height) > PALM_CSS) return "palm-sized";
      const c = getCanvasCoords(e);
      const w = screenToWorld(c.screenX, c.screenY, game.boardRect, boardTilt(game));
      if (w.x < VISIBLE_INSET || w.x > BOARD_WIDTH - VISIBLE_INSET || w.y < VISIBLE_INSET || w.y > BOARD_HEIGHT - VISIBLE_INSET) {
        return "off the board";
      }
      return null;
    };

    const clearSwipeState = (game: CanvasGameState) => {
      game.swipeStart       = null;
      game.swipeRegionId    = null;
      game.currentSwipePos  = null;
      game.swipePointerId   = null;
      swipe = null;
    };

    /** Make a set-aside finger the fence finger again, where it now is. */
    const activateStandby = (game: CanvasGameState) => {
      const s = standby;
      if (!s) return;
      standby = null;
      game.swipeStart       = s.start;
      game.swipeRegionId    = s.regionId;
      game.currentSwipePos  = s.current;
      game.swipePath        = [{ ...s.start }];
      game.swipePointerId   = s.pointerId;
      swipe = {
        pointerId: s.pointerId, startClient: s.startClient,
        travel: Math.hypot(s.lastClient.x - s.startClient.x, s.lastClient.y - s.startClient.y), fromGrip: s.fromGrip,
        downAt: performance.now(),
      };
      setIsPlayerDragging(true);
    };

    const handlePointerDown = (e: PointerEvent) => {
      initAudio();

      const game = gameRef.current;
      if (!game) return;
      // A touch on a canvas-interface widget that sits over the board (a
      // banner, an overlay's handle) is the widget's, not a cut (ui/hitGate).
      if (uiCovers(e.clientX, e.clientY)) {
        trace(() => `#${e.pointerId} down: on an interface widget, not the board`);
        return;
      }

      // A swipe this listener never saw start (the listeners were re-attached
      // mid-gesture, so its lift may never arrive here) belongs to no finger
      // this device is tracking. Left in place it would make every press a
      // "second" touch, and a hard press a palm.
      if (game.swipeStart && !swipe && standby === null) {
        trace(() => `#${e.pointerId} down: dropped a stale swipe from #${game.swipePointerId}`);
        clearSwipeState(game);
      }

      // Another finger already owns a gesture. A touch that looks like the
      // grip is ignored outright: it neither cancels that gesture nor starts
      // anything of its own (and its eventual lift is ignored too, below).
      const busy = gesture !== null || standby !== null ||
        (game.swipeStart !== null && game.swipePointerId !== null) || holdPointerId !== null;
      if (busy) {
        const stray = strayReason(e, game);
        if (stray) {
          trace(() => `#${e.pointerId} down: second touch at the ${stray}, ignored`);
          return;
        }
        // Two fingers down is not someone holding a thing to read about it.
        if (holdPointerId !== null && holdPointerId !== e.pointerId) clearHold();
      }

      // Second-finger cancel, for a Redeploy pull. The same meaning the second
      // finger already has for a cut, and it must come first: a throw that
      // cannot be called off is a throw nobody dares start.
      if (game.slingDrag && gesture?.kind === "sling" && e.pointerId !== gesture.pointerId) {
        // A pull that has not been let go is still only a drawing on this
        // device, so calling it off touches nothing the other player can see.
        game.slingDrag = null;
        gesture = null;
        if (navigator.vibrate) navigator.vibrate(30);
        trace(() => `#${e.pointerId} down: second finger, pull cancelled`);
        return;
      }

      // Second-finger cancel for a mover grab, with the meaning the second
      // finger already has everywhere else. A grab that cannot be called off is
      // a grab nobody dares start on a bumper.
      if (gesture?.kind === "mover" && e.pointerId !== gesture.pointerId) {
        // A held mover IS simulation state (the physics step drives it), so
        // letting go has to travel as a command even when it fires nothing.
        enqueueCommand(game, { kind: "moverRelease", player: getLocalPlayer(), cancel: true });
        gesture = null;
        if (navigator.vibrate) navigator.vibrate(30);
        trace(() => `#${e.pointerId} down: second finger, mover let go`);
        return;
      }

      // A second finger while a swipe is held. It cancels a fence that is
      // really being drawn, as it always has. But a swipe that has not moved
      // yet is not a fence anyone is drawing: it is a thumb resting on the
      // board, or a grip that got there first. Calling it off and then
      // swallowing the finger that came to draw left the board dead under a
      // perfectly good swipe. So the new finger takes over, and the old one is
      // set aside in case it turns out to be the one that moves.
      if (game.swipeStart && game.swipePointerId !== null && e.pointerId !== game.swipePointerId) {
        const travel = swipe?.travel ?? 0;
        if (travel >= HANDOFF_SLOP_CSS && !swipe?.fromGrip) {
          clearSwipeState(game);
          standby = null;
          setIsPlayerDragging(false);
          if (navigator.vibrate) navigator.vibrate(30);
          // Said, not only buzzed: when it was not meant (a palm that slipped
          // past the grip test), this is the one clue to what happened.
          onMessageRef?.current?.("secondFingerCancel");
          trace(() => `#${e.pointerId} down: second finger, fence cancelled`);
          return;
        }
        const prev = swipe;
        standby = prev && travel < HANDOFF_SLOP_CSS && game.swipeRegionId ? {
          pointerId: prev.pointerId, startClient: prev.startClient,
          lastClient: { x: prev.startClient.x, y: prev.startClient.y },
          start: game.swipeStart, current: game.currentSwipePos ?? game.swipeStart,
          regionId: game.swipeRegionId, fromGrip: prev.fromGrip,
        } : null;
        const from = game.swipePointerId;
        clearSwipeState(game);
        trace(() => `#${e.pointerId} down: takes the swipe from #${from}, which had not moved`);
      }

      press(game, e);

      // The new finger did not get a swipe of its own (refused, or a star):
      // the finger that was set aside for it gets its swipe back.
      // A press that became a grab ends the question of which finger draws.
      if (gesture) standby = null;
      else if (!game.swipeStart && standby) activateStandby(game);
      if (!game.swipeStart) setIsPlayerDragging(false);
    };

    /** Everything a press can start, once it is clear whose press it is. */
    const press = (game: CanvasGameState, e: PointerEvent) => {
      // Targeted ability armed (Magnet): consume this tap as the target point.
      // A tap outside the board cancels. Handled before the cut/guard logic so
      // it works during normal play regardless of active cell / region.
      if (game.armedAbility && onAbilityTargetRef?.current) {
        const c = getCanvasCoords(e);
        if (isPointInBoard(c.screenX, c.screenY, game.boardRect)) {
          onAbilityTargetRef.current(game.armedAbility, screenToWorld(c.screenX, c.screenY, game.boardRect, boardTilt(game)));
        } else {
          onAbilityTargetRef.current(null, null);
        }
        trace(() => `#${e.pointerId} down: aimed the armed ability`);
        return;
      }

      // game.dissolve also covers the run-intro assemble: no cuts while the
      // board is still flying together (physics is held until it lands).
      if (game.gameOver || game.levelComplete || game.dissolve || game.pushMode === "prompt" || game.pushPromptPending || game.isRecovering) {
        trace(() => `#${e.pointerId} down: not now (${
          game.gameOver ? "game over" : game.levelComplete ? "map complete" : game.dissolve ? "board moving"
            : game.isRecovering ? "recovering from a lost life" : "push prompt"})`);
        return;
      }

      // No fence until every barrel has finished ejecting. A cut during the
      // drain would seal balls the shot is mid-way through firing, which is the
      // exact mistake the lock-inside rule fails the map for - so it is refused
      // here rather than punished there. (Before firing the loop is already
      // paused; this also covers the drain window, when it is not.)
      if (fencesBlockedByLauncher(game)) {
        onMessageRef?.current?.("launcherLoaded");
        return trace(() => `#${e.pointerId} down: refused, launcher still firing`);
      }

      // No loot-collect branch here any more. A smashed chest grants its reward
      // on the smash (destructibles.ts), so the gem it drops is a receipt, not a
      // target - and a tap near one starts a fence like a tap anywhere else,
      // rather than being swallowed by a gem the player was not aiming for.

      // Press-and-hold opens an explainer. Checked before the cut logic so the
      // press arms a hold instead of a fence.
      //
      // A superior-lock star wins over whatever it is drawn on top of; otherwise
      // the hold explains the board object under the finger. Both share one
      // timer, so a press can only ever arm one of them.
      {
        const c = getCanvasCoords(e);
        if (isPointInBoard(c.screenX, c.screenY, game.boardRect)) {
          const w = screenToWorld(c.screenX, c.screenY, game.boardRect, boardTilt(game));
          const star = onSuperiorInfoRef?.current ? superiorStarAt(game, w) : null;
          const entity = star ? null : (onEntityInfoRef?.current ? boardEntityAt(game, w.x, w.y) : null);
          if (star || entity) {
            clearHold();
            holdPointerId = e.pointerId;
            holdStartWorld = w;
            holdTimer = setTimeout(() => {
              holdTimer = null;
              if (navigator.vibrate) navigator.vibrate(20);
              if (star) onSuperiorInfoRef?.current?.();
              else if (entity) onEntityInfoRef?.current?.(entity);
              clearHold();
            }, HOLD_MS);
            // Arming a hold must NOT block the cut: the player may simply be
            // starting a fence from a point that happens to sit on an obstacle,
            // and that is the common case. The fence begins as usual below; the
            // first movement past the slop cancels the hold. Only the star
            // returns early, because a star is never a place you start a cut.
            if (star) {
              trace(() => `#${e.pointerId} down: on a lock star, hold to read`);
              return;
            }
          }
        }
      }

      // Spectating (a pair, and the partner's turn: net/pairTurn.ts). Nothing
      // this finger could start would be applied, so nothing starts: no swipe
      // line to draw a fence that will never exist. After the hold arming on
      // purpose, since holding an object to read about it is watching, not
      // playing. The message only when that is not what the press is for.
      if (game.pairTurn && game.pairTurn.player !== getLocalPlayer()) {
        if (holdTimer === null) onMessageRef?.current?.("partnersTurn");
        trace(() => `#${e.pointerId} down: partner's turn`);
        return;
      }

      // A press on a loaded Redeploy fence GRABS it instead of starting a cut.
      //
      // Deliberately before the fence-limit check: pulling a fence back is not
      // drawing one, and refusing the throw because a fence happens to be
      // growing elsewhere would be a rule about the wrong thing. It is also
      // ahead of the cut path because that path would refuse this press
      // anyway - a press on a fence is "wall in the way" - so the gesture
      // replaces a refusal rather than competing with a cut.
      {
        const c = getCanvasCoords(e);
        if (isPointInBoard(c.screenX, c.screenY, game.boardRect)) {
          const w = screenToWorld(c.screenX, c.screenY, game.boardRect, boardTilt(game));
          const sling = loadedSlingAt(game, w);
          if (sling) {
            clearHold();
            game.slingDrag = {
              wallId: sling.id, start: w, current: w, pointerId: e.pointerId,
            };
            gesture = { kind: "sling", pointerId: e.pointerId };
            trace(() => `#${e.pointerId} down: grabbed a Redeploy fence`);
            return;
          }
        }
      }

      // A press on a MOVER takes hold of it (Control Freak). Placed here for
      // the same reason the sling grab is: this press would be refused by the
      // cut path anyway (a press on an obstacle is "wall in the way"), so the
      // gesture replaces a refusal rather than competing with a cut, and the
      // one control the game has stays the fence.
      //
      // The finger is the cost. While it is on a mover it is not drawing, which
      // is why the brake needs no ration of its own: holding a hazard still and
      // carving the board are the same hand.
      {
        const grabbing = activeModifiers.moverBrake > 0 || activeModifiers.moverDrive > 0;
        const c = getCanvasCoords(e);
        if (grabbing && isPointInBoard(c.screenX, c.screenY, game.boardRect)) {
          const w = screenToWorld(c.screenX, c.screenY, game.boardRect, boardTilt(game));
          const mover = moverAt(game, w.x, w.y);
          // Refused where the finger is when someone already holds it. Solo,
          // that someone is this player's own other finger, which the
          // second-finger cancel above has already dealt with.
          if (mover && !game.moverDrag) {
            clearHold();
            gesture = { kind: "mover", pointerId: e.pointerId, moverId: mover.id };
            enqueueCommand(game, {
              kind: "moverGrab",
              player: getLocalPlayer(),
              moverId: mover.id,
              pointer: { ...w },
              driveMultiplier: activeModifiers.moverDrive,
              canDerail: activeModifiers.moverDerailPerMap > 0 && game.moverDerailsRemaining > 0,
              canBand: activeModifiers.moverBandPerMap > 0 && game.moverBandsRemaining > 0,
            });
            trace(() => `#${e.pointerId} down: grabbed a mover`);
            return;
          }
        }
      }

      // At the concurrent-fence limit, no new cut can start.
      if (game.activeWalls.length >= concurrentFenceLimit(game, activeModifiers)) {
        onMessageRef?.current?.("fenceLimit");
        trace(() => `#${e.pointerId} down: refused, fence limit`);
        return;
      }

      const { screenX, screenY } = getCanvasCoords(e);

      // Outside the world rectangle, which already runs past the visible
      // board on every side (computeBoardRect), so this is a press in the
      // empty band above or below it: nothing there to refuse in words.
      if (!isPointInBoard(screenX, screenY, game.boardRect)) {
        trace(() => `#${e.pointerId} down: outside the board`);
        return;
      }

      const worldPos = screenToWorld(screenX, screenY, game.boardRect, boardTilt(game));

      if (!game.spaceGrid || !isPositionActive(game.spaceGrid, worldPos)) {
        if (import.meta.env.DEV) console.warn(`[cut-refused] start cell not active at (${worldPos.x | 0},${worldPos.y | 0}) - wrongly-captured cell?`);
        onMessageRef?.current?.("capturedStart");
        trace(() => `#${e.pointerId} down: refused, captured ground at (${worldPos.x | 0},${worldPos.y | 0})`);
        return;
      }

      const region = findRegionContainingPoint(game.regions, worldPos.x, worldPos.y);
      if (!region) {
        if (import.meta.env.DEV) console.warn(`[cut-refused] no region contains (${worldPos.x | 0},${worldPos.y | 0})`);
        // Same thing from the player's side as starting on captured ground:
        // there is nothing here to cut. Naming the internal difference would
        // explain the code rather than the game.
        onMessageRef?.current?.("capturedStart");
        trace(() => `#${e.pointerId} down: refused, no region at (${worldPos.x | 0},${worldPos.y | 0})`);
        return;
      }

      // Refuse only for walls that actually border the active region here. A fence
      // stranded in captured space (never pruned from game.walls) is invisible and
      // must not block a legal cut - see wallBlocksCutStart (ghost-wall fix).
      for (const w of game.walls) {
        if (wallBlocksCutStart(worldPos, w, game.spaceGrid)) {
          if (import.meta.env.DEV) console.warn(`[cut-refused] blocked by wall "${w.id}" at (${worldPos.x | 0},${worldPos.y | 0})`);
          onMessageRef?.current?.("wallInTheWay");
          trace(() => `#${e.pointerId} down: refused, wall in the way`);
          return;
        }
      }

      game.swipeStart       = worldPos;
      game.swipeRegionId    = region.id;
      game.currentSwipePos  = worldPos;
      game.swipePath        = [{ ...worldPos }];
      game.swipePointerId   = e.pointerId;
      swipe = {
        pointerId: e.pointerId, startClient: { x: e.clientX, y: e.clientY }, travel: 0,
        fromGrip: strayReason(e, game) !== null, downAt: performance.now(),
      };
      setIsPlayerDragging(true);
      trace(() => `#${e.pointerId} down: swipe started at (${worldPos.x | 0},${worldPos.y | 0})`);
    };

    /** A world point under the pointer, kept on the board, as a swipe end. */
    const swipePointAt = (game: CanvasGameState, e: PointerEvent): Vector2 => {
      const { screenX, screenY } = getCanvasCoords(e);
      const worldPos = screenToWorld(screenX, screenY, game.boardRect, boardTilt(game));
      worldPos.x = Math.max(0, Math.min(BOARD_WIDTH, worldPos.x));
      worldPos.y = Math.max(0, Math.min(BOARD_HEIGHT, worldPos.y));
      return worldPos;
    };

    const handlePointerMove = (e: PointerEvent) => {
      const game = gameRef.current;
      if (!game) return;

      // A superior-star hold is cancelled once the finger drifts past the slop.
      if (holdStartWorld !== null && e.pointerId === holdPointerId) {
        const c = getCanvasCoords(e);
        const w = screenToWorld(c.screenX, c.screenY, game.boardRect, boardTilt(game));
        const dx = w.x - holdStartWorld.x, dy = w.y - holdStartWorld.y;
        if (dx * dx + dy * dy > HOLD_MOVE_SLOP * HOLD_MOVE_SLOP) clearHold();
      }

      // A mover under the finger. Only the pointer is written here: turning it
      // into a position on the rail is the physics step's job, so input stays
      // ignorant of rails and physics stays the only author of where a mover is.
      if (gesture?.kind === "mover" && e.pointerId === gesture.pointerId) {
        const c = getCanvasCoords(e);
        enqueueCommand(game, {
          kind: "moverMove",
          player: getLocalPlayer(),
          pointer: screenToWorld(c.screenX, c.screenY, game.boardRect, boardTilt(game)),
        });
        return;
      }

      // A Redeploy fence being pulled back. Unclamped to the board on purpose:
      // the pull is a direction and a length, and clamping it at the edge would
      // silently cap the power of a throw aimed from near the frame.
      if (game.slingDrag && gesture?.kind === "sling" && e.pointerId === gesture.pointerId) {
        const c = getCanvasCoords(e);
        game.slingDrag.current = screenToWorld(c.screenX, c.screenY, game.boardRect, boardTilt(game));
        return;
      }

      // The finger that was set aside. If it is the one that starts moving
      // while the other is still resting, it was the drawing finger all along:
      // it gets the swipe back and the resting one is forgotten.
      if (standby && e.pointerId === standby.pointerId) {
        standby.lastClient = { x: e.clientX, y: e.clientY };
        standby.current = swipePointAt(game, e);
        if (clientDist(standby.startClient, e) < HANDOFF_SLOP_CSS) return;
        if (swipe && swipe.travel >= HANDOFF_SLOP_CSS) { standby = null; return; }
        const resting = game.swipePointerId;
        clearSwipeState(game);
        activateStandby(game);
        trace(() => `#${e.pointerId} move: the set-aside finger is drawing, #${resting} was resting`);
      }

      if (!game.swipeStart || !game.swipeRegionId || game.gameOver || game.levelComplete) return;
      if (e.pointerId !== game.swipePointerId) return;

      if (swipe) {
        swipe.travel = Math.max(swipe.travel, clientDist(swipe.startClient, e));
        // Drawing for real now: the finger set aside was resting after all.
        if (swipe.travel >= HANDOFF_SLOP_CSS) standby = null;
      }

      const worldPos = swipePointAt(game, e);
      game.currentSwipePos = worldPos;
      // Sample the path for bent fences (#66). Thinned by distance rather than
      // by frame: a slow drag emits a point per frame and would fill the buffer
      // with samples the simplifier throws away anyway, and a fast one on a
      // 120Hz phone would still be sampled finely enough to see its corners.
      const path = game.swipePath;
      const last = path[path.length - 1];
      if (!last || (worldPos.x - last.x) ** 2 + (worldPos.y - last.y) ** 2 >= SWIPE_SAMPLE_SPACING ** 2) {
        if (path.length < MAX_SWIPE_SAMPLES) path.push({ ...worldPos });
      }
    };

    /**
     * A finger left the glass: an up, a mouse leaving the canvas, or (with
     * `cancelled`) the system taking the touch away.
     *
     * Every branch is keyed on WHICH pointer it was. It used to be any
     * pointer at all, so lifting a resting thumb or a gripping finger ended
     * the fence someone else was drawing, at whatever length it had reached.
     */
    const release = (e: PointerEvent, cancelled: boolean) => {
      const game = gameRef.current;
      if (!game) return;

      // Releasing before the hold fires cancels the explainer (a star press
      // never set swipeStart, so the cut block below is a no-op for it).
      if (e.pointerId === holdPointerId) clearHold();

      // Let go of a mover. With a bumper fitted this fires the snap; without
      // one the mover simply stays where it was parked and resumes patrolling
      // from there. A cancelled touch lets go without firing.
      if (gesture?.kind === "mover" && e.pointerId === gesture.pointerId) {
        gesture = null;
        enqueueCommand(game, { kind: "moverRelease", player: getLocalPlayer(), ...(cancelled ? { cancel: true } : {}) });
        return;
      }

      // Let go of a Redeploy fence: it snaps forward and throws. Not when the
      // system took the touch: a throw's power is in where the finger let go,
      // and a cancelled touch never let go anywhere.
      const drag = game.slingDrag;
      if (drag && gesture?.kind === "sling" && e.pointerId === gesture.pointerId) {
        game.slingDrag = null;
        gesture = null;
        if (cancelled) { trace(() => `#${e.pointerId} cancelled by the system: pull dropped`); return; }
        enqueueCommand(game, {
          kind: "slingRelease",
          player: getLocalPlayer(),
          wallId: drag.wallId,
          pull: { x: drag.current.x - drag.start.x, y: drag.current.y - drag.start.y },
        });
        return;
      }

      if (standby && e.pointerId === standby.pointerId) {
        standby = null;
        trace(() => `#${e.pointerId} up: the set-aside finger lifted`);
        return;
      }

      if (game.swipePointerId === null || e.pointerId !== game.swipePointerId) {
        if (e.type !== "pointerleave") trace(() => `#${e.pointerId} ${cancelled ? "cancel" : "up"}: not the fence finger, ignored`);
        return;
      }

      // Where the finger actually left the glass. On a slow phone the last
      // move can be a frame behind the lift; a cancel has no position worth
      // trusting, so it keeps the last move.
      if (!cancelled && game.swipeStart) {
        game.currentSwipePos = swipePointAt(game, e);
        const path = game.swipePath;
        const last = path[path.length - 1];
        if (path.length < MAX_SWIPE_SAMPLES && (!last || last.x !== game.currentSwipePos.x || last.y !== game.currentSwipePos.y)) {
          path.push({ ...game.currentSwipePos });
        }
      }

      // How long the finger had been down says what took it: a cancel at about
      // half a second on a still finger is the long press (see contextmenu).
      const heldMs = swipe ? Math.round(performance.now() - swipe.downAt) : 0;
      const how = cancelled ? `cancelled by the system after ${heldMs}ms` : "up";

      if (
        game.swipeStart &&
        game.swipeRegionId &&
        game.currentSwipePos &&
        game.activeWalls.length < concurrentFenceLimit(game, activeModifiers) &&
        !game.gameOver &&
        !game.levelComplete &&
        !game.isRecovering &&
        game.pushMode !== "prompt" &&
        !game.pushPromptPending
      ) {
        const delta = vec2Sub(game.currentSwipePos, game.swipeStart);
        const dist  = vec2Length(delta);
        // A touch the system took away is not a tap, whatever its length: a
        // freeze or a squash nobody tapped for would be worse than nothing.
        const tap = dist < BASE_SWIPE_MIN_DISTANCE && !cancelled;

        // A tap on a BUG squashes it, killing it for no reward.
        //
        // First of the tap branches, because a bug flies OVER everything else
        // on the board and the finger is on the thing the player can see moving.
        //
        // This replaces press-and-hold, which was the explainer gesture here
        // and was unusable: a bug is nine world units across and travels 10-17
        // of them in the time it takes a touch to register, against 22 of slop,
        // and the 450ms hold then had to survive a 12-unit move slop that a
        // resting thumb drifts past. Reported as "press and hold doesn't work",
        // which it did not. A tap has to land once, on a target the same size,
        // and that is a gesture a moving thing can actually carry.
        if (tap) {
          const bug = bugAtTap(game, game.swipeStart);
          if (bug) {
            // Named, not described - see the tapBug command for why a point
            // would be the wrong thing to send about something that moves.
            enqueueCommand(game, { kind: "tapBug", player: getLocalPlayer(), bugId: bug.id });
            trace(() => `#${e.pointerId} up: tap, squashed a bug`);
            endSwipe(game);
            return;
          }
        }

        // Tappable ball (#57): a tap on a WHITE ball removes it for no points -
        // a relief valve, or the alternative to working for its big lock.
        // Checked BEFORE the freeze block (which skips white balls) and
        // regardless of freeze charges: tap-to-remove is the white ball's own
        // interaction, decided by ball type.
        if (tap && onTapRemoveRef?.current) {
          const at = game.swipeStart;
          let target: Ball | null = null;
          let bestDist = Infinity;
          for (const ball of game.balls) {
            if (ball.state !== "active") continue;
            if (ball.regionId !== game.swipeRegionId) continue;
            if (!isTappableBall(ball.ability)) continue;
            const d = vec2Length(vec2Sub(ball.position, at));
            if (d <= ball.radius + FREEZE_TAP_SLOP && d < bestDist) { bestDist = d; target = ball; }
          }
          if (target) {
            // The ball is named, not described: by the time the command is
            // applied the board has moved on a frame, and "the ball nearest
            // this point" would no longer be the ball the player tapped.
            enqueueCommand(game, { kind: "tapRemove", player: getLocalPlayer(), ballId: target.id });
            trace(() => `#${e.pointerId} up: tap, removed a white ball`);
            endSwipe(game);
            return;
          }
        }

        // Feature Freeze: a tap (movement below the cut threshold) on a ball
        // freezes it in place. Uses are LIMITED per map (game.freezeUsesRemaining,
        // refilled each map); once spent, a claimed pickup freeze charge is the
        // fallback. The cut path below is unreachable for taps, so no conflict.
        const featureFreeze = activeModifiers.ballFreezeDuration > 0 && (game.freezeUsesRemaining ?? 0) > 0;
        const hasFreezeCharge = (game.freezeCharges ?? 0) > 0;
        if (tap && (featureFreeze || hasFreezeCharge)) {
          // Only worth sending if it would land on something. Which ball, and
          // which of its neighbours go with it, is settled when the command is
          // applied, off state both devices share.
          if (freezeTargetAt(game, game.swipeStart, game.swipeRegionId)) {
            enqueueCommand(game, {
              kind: "freezeTap",
              player: getLocalPlayer(),
              at: { ...game.swipeStart },
              regionId: game.swipeRegionId,
              // A Feature Freeze use is spent before a stored charge, as it was
              // when this lived here: the per-map allowance expires with the
              // map and the charge does not.
              useCharge: !featureFreeze,
            });
            trace(() => `#${e.pointerId} up: tap, freeze`);
          } else {
            trace(() => `#${e.pointerId} up: tap on no ball`);
          }
        } else if (dist >= BASE_SWIPE_MIN_DISTANCE && game.pairTurn?.spent) {
          // One fence a turn in a pair. Taps above still work, since guarding
          // the fence that is building is still this player's turn.
          onMessageRef?.current?.("oneFenceATurn");
          trace(() => `#${e.pointerId} up: refused, one fence a turn`);
        } else if (dist >= BASE_SWIPE_MIN_DISTANCE) {
          // Bent fences (#66): keep the SHAPE of the drag and project only its
          // two loose ends. `bent` is null without the loadout, for a drag that
          // was straight after all, or for one the fence cannot follow (a
          // fold-back), and every one of those falls back to the straight cut
          // the swipe has always given rather than refusing the gesture.
          // The rays are cast where the command is applied, not here: both
          // devices hold the same walls at that tick and will land the fence in
          // the same place. What travels is the drag itself.
          //
          // Kept when the system cancels the touch, as it was when a cancel
          // reached here through pointerleave: the drag already said what it
          // was, and dropping a drawn fence is the very complaint this layer
          // keeps answering.
          const bent = bentDrawnPath(game);
          enqueueCommand(game, {
            kind: "cut",
            player: getLocalPlayer(),
            start: { ...game.swipeStart },
            end: { ...game.currentSwipePos },
            path: bent ? bent.map(p => ({ ...p })) : null,
            regionId: game.swipeRegionId,
            fenceTypeId: game.selectedFenceTypeId ?? STANDARD_FENCE_ID,
          });
          trace(() => `#${e.pointerId} ${how}: fence, ${dist | 0} units`);
        } else {
          trace(() => `#${e.pointerId} ${how}: too short for a fence (${dist.toFixed(1)} units)`);
        }
      } else if (game.swipeStart) {
        trace(() => `#${e.pointerId} up: swipe dropped, the board stopped taking fences`);
      }

      endSwipe(game);
    };

    /** The fence finger is done. A finger that was set aside gets its turn. */
    const endSwipe = (game: CanvasGameState) => {
      clearSwipeState(game);
      if (standby) activateStandby(game);
      else setIsPlayerDragging(false);
    };

    const handlePointerUp = (e: PointerEvent) => release(e, false);

    /**
     * The system took a touch away (an edge gesture, a notification, palm
     * rejection). Never listened for here before: the cancel only arrived by
     * way of the pointerleave that follows it, as an ordinary lift.
     */
    const handlePointerCancel = (e: PointerEvent) => release(e, true);

    /**
     * A finger held still on Android raises the long press: a `contextmenu`
     * at the touch-and-hold delay (500ms by default, 400ms on the "short"
     * accessibility setting). Left alone, the browser takes the touch for its
     * menu and CANCELS it, and every move after that goes nowhere. So a player
     * who puts a finger down, presses, and then draws (the careful way to
     * draw) got nothing at all. The board never has a menu; refused here.
     */
    const handleContextMenu = (e: Event) => {
      e.preventDefault();
      trace(() => "long press: the browser's context menu refused");
    };

    /**
     * Trace only: a press inside the board's box that some OTHER element
     * received. The board never hears those, so without this the trace would
     * show nothing at all for exactly the touches nobody can explain.
     */
    const handleAnyDown = (e: PointerEvent) => {
      if (e.target === canvas) return;
      const r = canvas.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      const el = e.target as Element | null;
      trace(() => `#${e.pointerId} down: over the board, but taken by <${el?.tagName?.toLowerCase() ?? "?"}${
        el?.className && typeof el.className === "string" ? ` .${el.className.trim().split(/\s+/).slice(0, 3).join(".")}` : ""}>`);
    };

    canvas.addEventListener("pointerdown",  handlePointerDown);
    window.addEventListener("pointerdown",  handleAnyDown, true);
    canvas.addEventListener("pointermove",  handlePointerMove);
    canvas.addEventListener("pointerup",    handlePointerUp);
    canvas.addEventListener("pointerleave", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerCancel);
    canvas.addEventListener("contextmenu",  handleContextMenu);

    return () => {
      clearHold();
      canvas.removeEventListener("pointerdown",  handlePointerDown);
      window.removeEventListener("pointerdown",  handleAnyDown, true);
      canvas.removeEventListener("pointermove",  handlePointerMove);
      canvas.removeEventListener("pointerup",    handlePointerUp);
      canvas.removeEventListener("pointerleave", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerCancel);
      canvas.removeEventListener("contextmenu",  handleContextMenu);
    };
    // canvasRef.current is intentional: re-attach listeners if the canvas
    // element is replaced (e.g. HMR). The ref object itself never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef.current, activeModifiers.instantFencesPerMap, activeModifiers.ballFreezeDuration, activeModifiers.ballFreezeCount, activeModifiers.freezeNoCooldown, onAbilityTargetRef, onSuperiorInfoRef, onTapRemoveRef]);
}
