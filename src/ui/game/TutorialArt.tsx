/**
 * TutorialArt: small, on-brand illustrations for the help modals, drawn in the
 * game's own visual language (dark dot-grid board, bright accent fences,
 * glowing balls). Each is a self-contained 150x120 box so it drops into any
 * modal. Canvas port of components/game/TutorialArt.tsx; the drawing itself
 * is in TutorialArtDraw.ts, in the SVG's own coordinates.
 */
import type { Graphics } from "pixi.js";
import { View } from "../kit/ui";
import {
  ART_H, ART_W, drawBreakArt, drawCircuitArt, drawFenceArt, drawLockArt, drawMoverArt, drawPickupArt,
} from "./TutorialArtDraw";

/** A fixed-size box holding one drawing (the draw functions are module-level, so stable). */
function ArtBox({ draw }: { draw: (g: Graphics) => void }) {
  return (
    <View layout={{ width: ART_W, height: ART_H }}>
      <pixiGraphics draw={draw} />
    </View>
  );
}

/** FENCE: drag to grow a slicing wall that partitions the board. */
export function FenceArt() {
  return <ArtBox draw={drawFenceArt} />;
}

/** LOCK: a ball fenced tight into a captured corner pocket. */
export function LockArt() {
  return <ArtBox draw={drawLockArt} />;
}

/** MOVER: an orange obstacle on a track; a ball bounces off it. */
export function MoverArt() {
  return <ArtBox draw={drawMoverArt} />;
}

/** BREAK: an amber block, cracked, with a ball smashing into it. */
export function BreakArt() {
  return <ArtBox draw={drawBreakArt} />;
}

/** PICKUP: a ball trapped in a pocket that covers a glowing power-up token. */
export function PickupArt() {
  return <ArtBox draw={drawPickupArt} />;
}

/** CIRCUIT: a teal node wired to a dim sleeping ball. */
export function CircuitArt() {
  return <ArtBox draw={drawCircuitArt} />;
}
