/**
 * The Rubber Band's drag: stretch it, see what it will catch, let go (canvas
 * port of components/game/RubberBandOverlay.tsx).
 *
 * Board-aligned: it covers GameCanvas's container (from `origin`) and takes the
 * board box in that container's CSS px. Because the surface is an interactive
 * canvas object, the board ignores the touches that land on it (hitGate), so a
 * drag here aims the band and never also cuts a fence.
 *
 * Mounted only while the ability is ARMED, which is what makes a one-finger
 * drag unambiguous - the game already knows this gesture is an aim and not a
 * cut, so there is nothing to disambiguate with a second finger.
 *
 * ── Why the catch is shown DURING the drag ──────────────────────────────────
 *
 * The whole ability is a decision about which balls to throw and what to break,
 * and a charge cannot be taken back. Showing the caught balls only on release
 * would make every use a bet on geometry the player cannot see. They are ringed
 * live instead, so letting go is a confirmation rather than a guess.
 */
import { useCallback, useRef, useState } from "react";
import type { FederatedPointerEvent, Graphics } from "pixi.js";
import { useTranslation } from "react-i18next";
import { Spline } from "lucide-react";
import { bandShape, type BandShape } from "@/lib/rubberBand";
import type { Vector2 } from "@/types/game";
import { COLOR, Icon, Label, ProgressBar, RADIUS, TEXT, tint, View } from "../kit/ui";
import { Inert } from "./boardParts";
import { dashedCircle, dashedLine } from "./boardDraw";
import { InteractiveTutorialOverlay } from "./InteractiveTutorialOverlay";
import { usePointerCancel } from "./boardDrag";
import { WrapText } from "./modalParts";
import {
  bandCatches, bandColour, bandPowerLabel, bandRelease, bandTutorialSeen, boardScale, containerToWorld,
  markBandTutorialSeen, worldToContainer, type BandTarget, type BoardBox,
} from "./rubberBandModel";

export type { BandTarget };

interface Props {
  canvasWidth: number;
  canvasHeight: number;
  canvasOffsetTop: number;
  canvasOffsetLeft: number;
  /** Everything the band could catch, in world units. Supplied by the caller so
   *  the highlight comes from the same board the effect will read. */
  targets: BandTarget[];
  onFire: (shape: BandShape) => void;
  onCancel: () => void;
  /** GameCanvas's container's top-left on screen, in CSS px. */
  origin: { x: number; y: number };
  /**
   * The container's size in CSS px: the drag surface. Omitted, it is the board
   * box widened to the container's centre line on each axis (the board is
   * centred horizontally, so that is exact across; down, it stops as far below
   * the board as the board is from the top).
   */
  size?: { width: number; height: number };
}

export function RubberBandOverlay({
  canvasWidth, canvasHeight, canvasOffsetTop, canvasOffsetLeft, targets, onFire, onCancel, origin, size,
}: Props) {
  const { t } = useTranslation();
  const [shape, setShape] = useState<BandShape | null>(null);
  const [dragging, setDragging] = useState(false);
  // Read once, on mount: the flag is written on the first band that actually
  // fires, so re-reading it mid-drag would pull the hand away a frame early.
  const [showTutorial, setShowTutorial] = useState(() => !bandTutorialSeen());
  // The drag in progress: where it began, which finger, and where that finger
  // was last seen (a cancelled touch ends there).
  const startRef = useRef<{ at: Vector2; pointer: number; last: Vector2 } | null>(null);

  const box: BoardBox = { canvasWidth, canvasHeight, canvasOffsetTop, canvasOffsetLeft };
  const scale = boardScale(box);
  const width = size?.width ?? Math.max(0, 2 * canvasOffsetLeft + canvasWidth);
  const height = size?.height ?? Math.max(0, 2 * canvasOffsetTop + canvasHeight);

  /** A pointer in WORLD units. */
  const world = (e: FederatedPointerEvent): Vector2 =>
    containerToWorld(box, { x: e.global.x - origin.x, y: e.global.y - origin.y });

  const onDown = (e: FederatedPointerEvent) => {
    if (startRef.current) return;
    const at = world(e);
    startRef.current = { at, pointer: e.pointerId, last: at };
    setDragging(true);
  };
  // Global, so the band follows a finger that leaves the surface: the DOM
  // captured the pointer for the same reason.
  const onMove = (e: FederatedPointerEvent) => {
    const s = startRef.current;
    if (!s || e.pointerId !== s.pointer) return;
    s.last = world(e);
    setShape(bandShape(s.at, s.last));
  };
  const finish = (end: Vector2) => {
    const s = startRef.current;
    if (!s) return;
    const outcome = bandRelease(s.at, end);
    startRef.current = null;
    setShape(null);
    setDragging(false);
    if ("fire" in outcome) {
      // Retire the hand only once a band has really been thrown. A cancelled
      // tap means the gesture did NOT land, which is exactly when the hint is
      // still worth showing.
      if (showTutorial) {
        setShowTutorial(false);
        markBandTutorialSeen();
      }
      onFire(outcome.fire);
    } else {
      onCancel();
    }
  };
  const onUp = (e: FederatedPointerEvent) => {
    if (startRef.current?.pointer === e.pointerId) finish(world(e));
  };
  // A cancelled touch is a release where the finger was last seen, as the DOM
  // overlay's onPointerCancel was.
  usePointerCancel(id => {
    const s = startRef.current;
    if (s?.pointer === id) finish(s.last);
  });

  const caught = bandCatches(shape, targets);
  const powerT = shape?.powerT ?? 0;
  const colour = bandColour(powerT);

  const draw = useCallback((g: Graphics) => {
    g.clear();
    if (!shape) return;
    const b: BoardBox = { canvasWidth, canvasHeight, canvasOffsetTop, canvasOffsetLeft };
    const s = (p: Vector2) => worldToContainer(b, p);
    // The stretch, from where the band sits along the way it will throw.
    dashedLine(g, s(shape.centre),
      s({ x: shape.centre.x + shape.heading.x * 46, y: shape.centre.y + shape.heading.y * 46 }),
      5, 6, { width: 2, color: colour, alpha: 0.7 });
    // The band itself: dark backing under a bright cord, so it reads against
    // the board's greens and against the code behind it.
    const a = s(shape.a), bb = s(shape.b);
    g.moveTo(a.x, a.y).lineTo(bb.x, bb.y).stroke({ width: (9 + powerT * 5) * scale, color: 0x000000, alpha: 0.55, cap: "round" });
    g.moveTo(a.x, a.y).lineTo(bb.x, bb.y).stroke({ width: (5 + powerT * 4) * scale, color: colour, cap: "round" });
    // Its posts, so it reads as strung between two points.
    for (const p of [a, bb]) g.circle(p.x, p.y, Math.max(3, 5 * scale)).fill({ color: colour });
    // Everything it would catch, ringed LIVE. The charge cannot be taken back,
    // so letting go has to be a confirmation.
    for (const tg of caught) {
      const c = s(tg);
      const r = Math.max(8, (tg.radius + 8) * scale);
      const look = { width: Math.max(2, 2.5 * scale), color: colour };
      if (tg.kind === "object") dashedCircle(g, c, r, 4, 4, look);
      else g.circle(c.x, c.y, r).stroke(look);
    }
  }, [shape, caught, colour, powerT, scale, canvasWidth, canvasHeight, canvasOffsetTop, canvasOffsetLeft]);

  return (
    <layoutContainer
      label="rubber-band-surface"
      layout={{ position: "absolute", left: origin.x, top: origin.y, width, height }}
      eventMode="static"
      onPointerDown={onDown}
      onGlobalPointerMove={onMove}
      onPointerUp={onUp}
      onPointerUpOutside={onUp}
    >
      <pixiGraphics draw={draw} />

      <Inert layout={{ position: "absolute", left: 0, top: canvasOffsetTop + 8, width, alignItems: "center", gap: 4 }}>
        <View layout={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon icon={Spline} size={14} color={colour} />
          <Label text={t("rubberBand.pullToFire")} size={TEXT.xs} upper letterSpacing={TEXT.xs * 0.025} color={COLOR.mutedForeground} />
        </View>
        {shape && (
          <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <ProgressBar value={powerT} color={colour} track={tint(COLOR.muted, 0.4)} layout={{ width: 96 }} />
            <Label text={t("rubberBand.power", {
              power: bandPowerLabel(powerT),
              // `n`, not `count`: `count` would send i18next looking for plural
              // variants of the key that these locales do not define.
              n: caught.length,
            })} size={TEXT.sm} weight="700" color={colour} />
          </View>
        )}
      </Inert>

      {/* The map-1 hand, reused. It is inert, so it demonstrates the drag over
          the very surface that is listening for it. */}
      {showTutorial && (
        <>
          <InteractiveTutorialOverlay
            tutorialStep="showingHint"
            isPlayerDragging={dragging}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
            canvasOffsetTop={canvasOffsetTop}
            canvasOffsetLeft={canvasOffsetLeft}
            origin={{ x: 0, y: 0 }}
          />
          {!dragging && (
            <Inert layout={{ position: "absolute", left: 0, top: canvasOffsetTop + canvasHeight - 48, width, alignItems: "center" }}>
              <View layout={{
                width: Math.min(288, width - 32), paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6,
                borderRadius: RADIUS.lg, backgroundColor: tint(COLOR.background, 0.85), borderWidth: 1, borderColor: COLOR.border,
              }}>
                <WrapText text={t("rubberBand.tutorial")} size={TEXT.xs} align="center" />
              </View>
            </Inert>
          )}
        </>
      )}
    </layoutContainer>
  );
}
