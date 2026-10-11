/**
 * The board's transient effects: the reward toast, the beat warning, the
 * ability glyph pop, the armed ability's prompt, the bonus-fence pulse and the
 * red hit flash. They were written inline in GameCanvas's render, positioned in
 * its container; here they are one canvas component over that container.
 *
 * Every one is inert: they announce, they never take the cut the player is
 * making while they are on screen. Each keyed effect restarts its animation
 * when its `key` changes, as the DOM's keyed CSS animations did.
 */
import { useCallback } from "react";
import type { Graphics } from "pixi.js";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import type { BeatEffectLine } from "@/lib/physics/mapBeats";
import { Icon, Label, RADIUS, TEXT, tint, usePulse, useUiScreen } from "../kit/ui";
import { AbilityIcon } from "./AbilityIcon";
import { Inert } from "./boardParts";
import { outerGlow } from "./boardDraw";
import { useElapsed } from "./fxClock";
import { ABILITY_ICON, BONUS_PULSE, CHEST_TOAST, SM_BREAKPOINT, cssHex, sampleKeyframes } from "./fxModel";

interface Props {
  /** GameCanvas's container's top-left on screen, in CSS px. */
  origin: { x: number; y: number };
  /** The container's size in CSS px. */
  width: number;
  height: number;
  /** The board's top edge as a share (0..100) of the container's height. */
  boardTopPct: number;
  chestToast: { key: number; label: string; color: string } | null;
  beatBanner: { key: number; announce: string; effects?: BeatEffectLine[] } | null;
  abilityIconFx: { key: number; kind: string; color: string; xPct: number; yPct: number } | null;
  armedPrompt: { text: string; color: string } | null;
  bonusPulseKey: number;
  screenFlash: "none" | "red";
  /** The board's rect inside the container, CSS px. */
  boardFrame: { left: number; top: number; width: number; height: number } | null;
}

/** The toasts' dark plate. */
const PLATE = 0x0a0e14;
/**
 * The toasts are one line (the DOM's whitespace-nowrap), and the DOM let a long
 * one run off both sides of a phone. Capped at the container less this, a
 * long line scales down to fit instead.
 */
const PLATE_INSET = 16;
const SHRINK = { flexShrink: 1 };

export function BoardToasts({
  origin, width, height, boardTopPct, chestToast, beatBanner, abilityIconFx, armedPrompt,
  bonusPulseKey, screenFlash, boardFrame,
}: Props) {
  const screen = useUiScreen();
  const wide = screen.width >= SM_BREAKPOINT;
  return (
    <Inert label="board-toasts" layout={{ position: "absolute", left: origin.x, top: origin.y, width, height }}>
      {/* The bonus fence's reward: a soft green glow breaking outward from the
          board. The DOM drew a radial gradient BEHIND the board, spilling past
          it; this canvas is above the board, so the glow rings the frame
          instead of washing over the play. */}
      {bonusPulseKey > 0 && (
        <BonusPulse key={bonusPulseKey} frame={boardFrame ?? { left: 0, top: 0, width, height }} />
      )}
      {chestToast && (
        <ChestToast key={chestToast.key} label={chestToast.label} color={cssHex(chestToast.color)}
          top={height * 0.18} width={width} wide={wide} />
      )}
      {beatBanner && (
        // Anchored just ABOVE the board's top edge so the toast sits in the
        // gutter over the HUD, never covering the map; kept compact (chest-toast
        // sizing) so it fits the thin band above the board.
        <BeatBanner key={beatBanner.key} announce={beatBanner.announce} effects={beatBanner.effects}
          bottom={height - (boardTopPct / 100) * height + 4} width={width} wide={wide} />
      )}
      {abilityIconFx && (
        <AbilityPop key={abilityIconFx.key} kind={abilityIconFx.kind} color={cssHex(abilityIconFx.color)}
          x={(abilityIconFx.xPct / 100) * width} y={(abilityIconFx.yPct / 100) * height} size={wide ? 80 : 64} />
      )}
      {/* What the armed ability is waiting for (GameCanvas words it per kind,
          and leaves the rubber band out: its own overlay carries a header). */}
      {armedPrompt && (
        <ArmedPrompt text={armedPrompt.text} color={cssHex(armedPrompt.color)} top={height * 0.12} width={width} wide={wide} />
      )}
      {/* The hit flash covers the play region, as the DOM's did: its nearest
          positioned ancestor was the region, which runs on to the screen's foot. */}
      {screenFlash === "red" && (
        <Inert layout={{
          position: "absolute", left: 0, top: 0,
          width: Math.max(width, screen.width - origin.x), height: Math.max(height, screen.height - origin.y),
          backgroundColor: tint(0xef4444, 0.4),
        }} />
      )}
    </Inert>
  );
}

function ChestToast({ label, color, top, width, wide }: { label: string; color: number; top: number; width: number; wide: boolean }) {
  const t = useElapsed(CHEST_TOAST.duration);
  const k = sampleKeyframes(CHEST_TOAST.frames, t / CHEST_TOAST.duration);
  return (
    <Inert layout={{ position: "absolute", left: 0, top, width, flexDirection: "row", justifyContent: "center" }}>
      <layoutContainer layout={{
        maxWidth: width - PLATE_INSET, paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: RADIUS.md,
        backgroundColor: tint(PLATE, 0.72), borderWidth: 1, borderColor: color,
      }} alpha={k.alpha} y={k.y} scale={k.scale}>
        <Label text={label} size={wide ? TEXT.base : TEXT.sm} font="mono" weight="700" color={color} layout={SHRINK} />
      </layoutContainer>
    </Inert>
  );
}

function BeatBanner({ announce, effects, bottom, width, wide }: {
  announce: string; effects?: BeatEffectLine[]; bottom: number; width: number; wide: boolean;
}) {
  const { t } = useTranslation();
  const pulse = usePulse(2000);
  const size = wide ? TEXT.base : TEXT.sm;
  const ink = 0xffcf7a;
  return (
    <Inert layout={{ position: "absolute", left: 0, bottom, width, flexDirection: "row", justifyContent: "center" }}
      alpha={0.6 + 0.4 * pulse}>
      <Inert layout={{
        maxWidth: width - PLATE_INSET, flexDirection: "row", alignItems: "center", gap: 8,
        paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: RADIUS.md,
        backgroundColor: tint(0x1e0a04, 0.82), borderWidth: 1, borderColor: tint(0xffb454, 0x99 / 255),
      }}>
        {/* The DOM's warning glyph, as the icon set's own triangle. */}
        <Icon icon={AlertTriangle} size={size} color={ink} />
        <Label text={t(announce)} size={size} font="mono" weight="700" color={ink} layout={SHRINK} />
        {/* What the beat is about to DO. The flavour name alone telegraphs
            that something is coming but not what, which is how an extra ball
            still arrived unexplained. Same line, to stay in the thin band. */}
        {effects?.map(effect => (
          <Label key={effect.key} text={`· ${t(effect.key, effect.values)}`} size={size} font="mono" color={ink} alpha={0.9} layout={SHRINK} />
        ))}
      </Inert>
    </Inert>
  );
}

function AbilityPop({ kind, color, x, y, size }: { kind: string; color: number; x: number; y: number; size: number }) {
  const t = useElapsed(ABILITY_ICON.duration);
  const k = sampleKeyframes(ABILITY_ICON.frames, t / ABILITY_ICON.duration);
  return (
    <layoutContainer layout={{ position: "absolute", left: x - size / 2, top: y - size / 2, width: size, height: size }}
      alpha={k.alpha} scale={k.scale}>
      <AbilityIcon kind={kind} size={size} color={color} />
    </layoutContainer>
  );
}

function ArmedPrompt({ text, color, top, width, wide }: { text: string; color: number; top: number; width: number; wide: boolean }) {
  const pulse = usePulse(2000);
  return (
    <Inert layout={{ position: "absolute", left: 0, top, width, flexDirection: "row", justifyContent: "center" }}
      alpha={0.6 + 0.4 * pulse}>
      <Inert layout={{
        maxWidth: width - PLATE_INSET, paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: RADIUS.md,
        backgroundColor: tint(PLATE, 0.8), borderWidth: 1, borderColor: color,
      }}>
        <Label text={text} size={wide ? TEXT.sm : TEXT.xs} font="mono" weight="700" color={color} layout={SHRINK} />
      </Inert>
    </Inert>
  );
}

/** How far past the board's edge the pulse travels, as a share of the board's short side. */
const PULSE_REACH = 0.25;

function BonusPulse({ frame }: { frame: { left: number; top: number; width: number; height: number } }) {
  const t = useElapsed(BONUS_PULSE.duration);
  const k = sampleKeyframes(BONUS_PULSE.frames, t / BONUS_PULSE.duration);
  const { left, top, width, height } = frame;
  const draw = useCallback((g: Graphics) => {
    g.clear();
    // The ring rides outward from the frame as the DOM gradient's scale grew
    // (0.6 -> 1.7), fading on the same curve.
    const out = ((k.scale - 0.6) / (1.7 - 0.6)) * PULSE_REACH * Math.min(width, height);
    // A wash hugging the frame, for the gradient's bright centre...
    outerGlow(g, left, top, width, height, 0x00ff88, 0.45 * k.alpha, 48, 4);
    // ...and the travelling ring.
    outerGlow(g, left - out, top - out, width + 2 * out, height + 2 * out, 0x00ff88, 0.75 * k.alpha, 28, 3);
  }, [k.scale, k.alpha, left, top, width, height]);
  if (t >= BONUS_PULSE.duration) return null;
  return <pixiGraphics draw={draw} />;
}
