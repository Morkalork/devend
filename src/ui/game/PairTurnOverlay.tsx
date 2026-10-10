/**
 * PairTurnOverlay - whose go it is, on the board itself (net/pairTurn.ts;
 * canvas port of components/game/PairTurnOverlay.tsx).
 *
 * A pair takes turns: one fences, the other watches. The difference has to be
 * readable from arm's length and from the corner of an eye, so the two states
 * differ in the board, not only in words:
 *
 *   - YOUR TURN: the board glows in your fence colour, breathing, with a
 *     "Your turn" tag and a Pass button. The hand-over gets a splash.
 *   - SPECTATING: the board dims and the glow goes, and the tag says whose
 *     turn it is instead, with an eye. Dimmed, not hidden: watching the
 *     partner's fence race a ball is the spectator's half of the game.
 *
 * The tag sits at the BOTTOM of the board: the top is where the link banner
 * goes when the partner's phone goes quiet, and the two must never stack.
 * Nothing here acts on a tap except Pass (the tag itself, like the DOM's,
 * swallows the touch it sits under).
 */
import { useTranslation } from "react-i18next";
import { Eye, Hammer, PenLine, SkipForward } from "lucide-react";
import type { TurnView } from "@/lib/net/pairTurn";
import { COLOR, Icon, Label, Pressable, RADIUS, TEXT, tint, usePulse, useTween } from "../kit/ui";
import { Blocker, GlowFrame, Inert, Region } from "./boardParts";
import { useElapsed } from "./fxClock";
import { PAIR_SPLASH, cssHex, sampleKeyframes, EASE } from "./fxModel";
import { turnColor, turnGlowAlpha, turnSplashes } from "./overlayModel";

interface Props {
  turn: { view: TurnView; seq: number } | null | undefined;
  partnerName: string;
  /** This player's fence colour, and the partner's. */
  myColor: string;
  partnerColor: string;
  onPass?: () => void;
  /** The play region's top-left on screen, in CSS px (the DOM's positioned wrapper). */
  origin: { x: number; y: number };
  /** The play region's size in CSS px. */
  width: number;
  height: number;
}

export function PairTurnOverlay({ turn, partnerName, myColor, partnerColor, onPass, origin, width, height }: Props) {
  const { t } = useTranslation();
  const mine = turn ? turn.view !== "theirs" : true;
  // Spectating: the board steps back. Starts at its target (framer's initial={false}).
  const dim = useTween(mine ? 0 : 1, 0.35);
  const pulse = usePulse(1800, turn?.view === "yours");
  if (!turn) return null;
  const color = turnColor(turn.view, myColor, partnerColor);
  const c = cssHex(color);

  return (
    <Region label="pair-turn" layout={{ position: "absolute", left: origin.x, top: origin.y, width, height }}>
      <Inert label="pair-spectator-dim" alpha={dim}
        layout={{ position: "absolute", left: 0, top: 0, width, height, backgroundColor: tint(0x000000, 0.32) }} />

      {/* Your turn: the board lights up in your colour and breathes while the
          fence is still yours to draw; it holds steady once it is drawn. */}
      {mine && <TurnGlow view={turn.view} pulse={pulse} color={cssHex(myColor)} width={width} height={height} />}

      {/* The tag. */}
      <Region layout={{ position: "absolute", left: 0, bottom: 8, width, flexDirection: "row", justifyContent: "center" }}>
        <Blocker label="pair-turn-tag" layout={{
          flexDirection: "row", alignItems: "center", gap: 8,
          paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: RADIUS.full,
          backgroundColor: tint(COLOR.background, 0.9), borderWidth: 1.5, borderColor: c,
        }}>
          {turn.view === "yours" && (
            <>
              <Icon icon={PenLine} size={16} color={c} />
              <Label text={t("pair.turn.yours")} size={TEXT.sm} weight="700" color={c} />
              <Label text={t("pair.turn.yoursHint")} size={TEXT.sm} color={COLOR.mutedForeground} />
              {onPass && (
                <Pressable onTap={onPass} label="pass" layout={{
                  marginLeft: 4, flexDirection: "row", alignItems: "center", gap: 4, borderRadius: RADIUS.full,
                  backgroundColor: COLOR.muted, paddingLeft: 8, paddingRight: 8, paddingTop: 2, paddingBottom: 2,
                }}>
                  <Icon icon={SkipForward} size={12} color={COLOR.foreground} />
                  <Label text={t("pair.turn.pass")} size={TEXT.xs} weight="600" />
                </Pressable>
              )}
            </>
          )}
          {turn.view === "yoursSpent" && (
            <>
              <Icon icon={Hammer} size={16} color={c} />
              <Label text={t("pair.turn.building")} size={TEXT.sm} weight="700" color={c} />
              <Label text={t("pair.turn.buildingHint", { name: partnerName })} size={TEXT.sm} color={COLOR.mutedForeground} />
            </>
          )}
          {turn.view === "theirs" && (
            <>
              <Icon icon={Eye} size={16} color={COLOR.mutedForeground} />
              <Label text={t("pair.turn.spectating")} size={TEXT.sm} weight="700" color={COLOR.mutedForeground} />
              <Label text={t("pair.turn.theirs", { name: partnerName })} size={TEXT.sm} color={c} />
            </>
          )}
        </Blocker>
      </Region>

      {/* The hand-over, once, big. Keyed on the turn number so every change of
          hands plays it, and gone in a second so it never covers play. */}
      {turnSplashes(turn.view) && (
        <TurnSplash key={turn.seq} width={width} height={height} color={c}
          text={turn.view === "yours" ? t("pair.turn.splashYours") : t("pair.turn.splashTheirs", { name: partnerName })} />
      )}
    </Region>
  );
}

function TurnGlow({ view, pulse, color, width, height }: { view: TurnView; pulse: number; color: number; width: number; height: number }) {
  // Fades in from nothing on the hand-over (framer's initial opacity 0).
  const enter = useElapsed(0.3);
  return (
    <Inert label="pair-turn-glow" layout={{ position: "absolute", left: 0, top: 0, width, height }}
      alpha={turnGlowAlpha(view, pulse) * EASE.out(enter / 0.3)}>
      <GlowFrame width={width} height={height} color={color} border={3}
        inner={{ blur: 30, alpha: 0x55 / 255 }} outer={{ blur: 24, alpha: 0xaa / 255 }} />
    </Inert>
  );
}

function TurnSplash({ text, color, width, height }: { text: string; color: number; width: number; height: number }) {
  const t = useElapsed(PAIR_SPLASH.duration);
  const k = sampleKeyframes(PAIR_SPLASH.frames, t / PAIR_SPLASH.duration, EASE.inOut);
  if (t >= PAIR_SPLASH.duration) return null;
  return (
    <Inert layout={{ position: "absolute", left: 0, top: 0, width, height, justifyContent: "center", alignItems: "center" }}>
      <layoutContainer layout={{
        paddingLeft: 20, paddingRight: 20, paddingTop: 8, paddingBottom: 8, borderRadius: RADIUS.xl,
        backgroundColor: tint(COLOR.background, 0.8),
      }} alpha={k.alpha} scale={k.scale}>
        <Label text={text} size={TEXT["3xl"]} font="display" weight="700" color={color} glow={12} />
      </layoutContainer>
    </Inert>
  );
}
