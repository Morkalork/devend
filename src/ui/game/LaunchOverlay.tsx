/**
 * The plunger: pull the band across the back of the barrel, release, and the
 * map begins (canvas port of components/game/LaunchOverlay.tsx).
 *
 * Board-aligned: it covers GameCanvas's container (from `origin`) and takes the
 * board box in that container's CSS px. The surface is an interactive canvas
 * object, so the board ignores the touches that land on it (hitGate).
 *
 * The drag is read as a slingshot - pull the band back down the barrel and let
 * go - because that is the gesture every catapult in every game has taught, and
 * because pulling toward yourself keeps the finger off the part of the board
 * you are about to fire into.
 *
 * The shot goes straight out of the muzzle and the pull decides only how fast
 * (see lib/launcher.ts for why the aim cone went). That is what lets this
 * overlay be honest: the line drawn here is the line EVERY ball in the barrel
 * takes. Nothing here decides anything about the shot.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { FederatedPointerEvent, Graphics } from "pixi.js";
import { useTranslation } from "react-i18next";
import { Zap } from "lucide-react";
import type { LaunchAim, LaunchFacing } from "@/lib/launcher";
import type { Vector2 } from "@/types/game";
import { COLOR, Icon, Label, ProgressBar, TEXT, tint, View } from "../kit/ui";
import { Inert } from "./boardParts";
import { dashedLine } from "./boardDraw";
import { LAUNCH_AMBER, launchGeometry, launchPowerT, readLaunchAim } from "./launchModel";
import { worldToContainer, type BoardBox } from "./rubberBandModel";

interface Props {
  /** Board box in the container's CSS pixels. */
  canvasWidth: number;
  canvasHeight: number;
  canvasOffsetTop: number;
  canvasOffsetLeft: number;
  /** Where the muzzle-end ball is sitting, in world units. */
  ballPosition: Vector2;
  /** How many balls the barrel will send down this line. */
  loadedCount?: number;
  /** The barrel's interior, in its own axis-aligned frame. */
  inner: { x: number; y: number; width: number; height: number };
  /** The barrel's turn in degrees; the muzzle is `facing` turned by this. */
  angle?: number;
  facing: LaunchFacing;
  /** Predicted path for an aim, in WORLD points. Supplied by the caller so the
   *  preview comes from the same physics the ball will obey. */
  predict: (aim: LaunchAim) => Vector2[];
  onFire: (aim: LaunchAim) => void;
  /** GameCanvas's container's top-left on screen, in CSS px. */
  origin: { x: number; y: number };
  /** The container's size in CSS px: the drag surface (see RubberBandOverlay's for the fallback). */
  size?: { width: number; height: number };
}

export function LaunchOverlay({
  canvasWidth, canvasHeight, canvasOffsetTop, canvasOffsetLeft,
  ballPosition, inner, angle, facing, predict, onFire, loadedCount = 1, origin, size,
}: Props) {
  const { t } = useTranslation();
  const [aim, setAim] = useState<LaunchAim | null>(null);
  const startRef = useRef<{ at: Vector2; pointer: number } | null>(null);

  const box: BoardBox = { canvasWidth, canvasHeight, canvasOffsetTop, canvasOffsetLeft };
  const width = size?.width ?? Math.max(0, 2 * canvasOffsetLeft + canvasWidth);
  const height = size?.height ?? Math.max(0, 2 * canvasOffsetTop + canvasHeight);

  /** A pointer in the container's CSS px. */
  const local = (e: FederatedPointerEvent): Vector2 => ({ x: e.global.x - origin.x, y: e.global.y - origin.y });

  const onDown = (e: FederatedPointerEvent) => {
    if (startRef.current) return;
    startRef.current = { at: local(e), pointer: e.pointerId };
  };
  // Global, so the pull follows a finger that leaves the surface (the DOM
  // captured the pointer for the same reason).
  const onMove = (e: FederatedPointerEvent) => {
    const s = startRef.current;
    if (s && e.pointerId === s.pointer) setAim(readLaunchAim(box, s.at, local(e), facing, angle));
  };
  const onUp = (e: FederatedPointerEvent) => {
    const s = startRef.current;
    if (!s || e.pointerId !== s.pointer) return;
    const finalAim = readLaunchAim(box, s.at, local(e), facing, angle);
    startRef.current = null;
    setAim(null);
    // A pull too short to register is not a weak launch, it is no launch: the
    // shot cannot be taken back, so a stray tap must not spend it.
    if (finalAim) onFire(finalAim);
  };

  const geo = launchGeometry({ ...box, ballPosition, inner, angle, facing, aim });
  const path = useMemo(() => (aim ? predict(aim) : []), [aim, predict]);
  const powerT = launchPowerT(aim);

  const draw = useCallback((g: Graphics) => {
    g.clear();
    const b: BoardBox = { canvasWidth, canvasHeight, canvasOffsetTop, canvasOffsetLeft };
    // The barrel's line: where the shot goes, before and during the pull.
    dashedLine(g, geo.ball, geo.lineEnd, 6, 8, { width: 2, color: LAUNCH_AMBER, alpha: 0.35 });

    // Predicted path, from the same physics the ball will obey.
    if (path.length > 1) {
      const pts = path.map(p => worldToContainer(b, p));
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.stroke({ width: 3, color: LAUNCH_AMBER, alpha: 0.9, join: "round" });
    }

    // The rubber band across the closed end, bowed back by the pull: a
    // quadratic on the dragged midpoint, so it stretches the way a band
    // does instead of hinging like a lever. Always drawn, because it is the
    // control: a player has to see what to pull before they have pulled it.
    // Twice, a dark backing under a bright band: a single thin stroke was
    // reported as "there is no rubber band effect" - at a phone's scale the
    // bore is about thirty pixels wide.
    const { bandA, bandB, bandMid } = geo;
    const band = () => g.moveTo(bandA.x, bandA.y).quadraticCurveTo(bandMid.x, bandMid.y, bandB.x, bandB.y);
    band();
    g.stroke({ width: aim ? 13 : 10, color: 0x000000, alpha: 0.55, cap: "round" });
    band();
    g.stroke({ width: aim ? 9 : 6, color: LAUNCH_AMBER, cap: "round" });
    // The posts the band is strung between, so it reads as attached to the
    // barrel rather than floating across it.
    g.circle(bandA.x, bandA.y, 4).fill({ color: LAUNCH_AMBER, alpha: 0.9 });
    g.circle(bandB.x, bandB.y, 4).fill({ color: LAUNCH_AMBER, alpha: 0.9 });
    // The grip, at the middle of the band: the thing to put a thumb on. A halo
    // at rest so it is findable before anything is moving.
    if (!aim) g.circle(bandMid.x, bandMid.y, 20).stroke({ width: 2, color: LAUNCH_AMBER, alpha: 0.45 });
    g.circle(bandMid.x, bandMid.y, aim ? 14 : 11).fill({ color: LAUNCH_AMBER }).stroke({ width: 2, color: 0x000000, alpha: 0.55 });
    // The loaded balls are NOT drawn here: the board keeps rendering under this
    // overlay and already draws them, in their own colours.
  }, [geo, path, aim, canvasWidth, canvasHeight, canvasOffsetTop, canvasOffsetLeft]);

  return (
    <layoutContainer
      label="launch-surface"
      layout={{ position: "absolute", left: origin.x, top: origin.y, width, height }}
      eventMode="static"
      onPointerDown={onDown}
      onGlobalPointerMove={onMove}
      onPointerUp={onUp}
      onPointerUpOutside={onUp}
    >
      <pixiGraphics draw={draw} />

      {/* Read-out. Says what the pull BUYS, not just how hard it is: the whole
          reason to pull harder is the base multiplier, so the number the player
          is bidding for has to be on screen while they are bidding. */}
      <Inert layout={{ position: "absolute", left: 0, top: canvasOffsetTop + 8, width, alignItems: "center", gap: 4 }}>
        <View layout={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon icon={Zap} size={14} color={LAUNCH_AMBER} />
          <Label text={t("launcher.pullToLaunch")} size={TEXT.xs} upper letterSpacing={TEXT.xs * 0.025} color={COLOR.mutedForeground} />
        </View>
        {aim && (
          <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <ProgressBar value={powerT} color={LAUNCH_AMBER} track={tint(COLOR.muted, 0.4)} layout={{ width: 96 }} />
            <Label text={t("launcher.basePay", { multiplier: aim.power.toFixed(1) })} size={TEXT.sm} weight="700" color={LAUNCH_AMBER} />
            {/* The roster, because the drawn path is every one of their paths:
                "this line, three times". Two words, so the row never wraps
                onto a second line over the board. */}
            {loadedCount > 1 && (
              <Label text={t("launcher.ballsOnTheLine", { count: loadedCount })} size={TEXT.sm} weight="700" color={LAUNCH_AMBER} alpha={0.8} />
            )}
          </View>
        )}
      </Inert>
    </layoutContainer>
  );
}
