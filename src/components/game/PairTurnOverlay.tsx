/**
 * PairTurnOverlay — whose go it is, on the board itself (net/pairTurn.ts).
 *
 * A pair takes turns: one fences, the other watches. The difference has to be
 * readable from arm's length and from the corner of an eye, because the
 * player who is not fencing is by definition not looking for a label. So the
 * two states differ in the board, not only in words:
 *
 *   - YOUR TURN: the board glows in your fence colour, breathing, with a
 *     "Your turn" tag and a Pass button. The hand-over itself gets a splash
 *     and a buzz (GameCanvas), for the player who had looked away.
 *   - SPECTATING: the board dims and the glow goes, and the tag says whose
 *     turn it is instead, with an eye. The board is still fully visible:
 *     watching the partner's fence race a ball is the spectator's half of the
 *     game.
 *
 * The tag sits at the BOTTOM of the board: the top is where the link banner
 * goes when the partner's phone goes quiet, and the two must never stack.
 * Nothing here takes a tap except Pass.
 */
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Eye, Hammer, PenLine, SkipForward } from "lucide-react";
import type { TurnView } from "@/lib/net/pairTurn";

interface Props {
  turn: { view: TurnView; seq: number } | null | undefined;
  partnerName: string;
  /** This player's fence colour, and the partner's. */
  myColor: string;
  partnerColor: string;
  onPass?: () => void;
}

export function PairTurnOverlay({ turn, partnerName, myColor, partnerColor, onPass }: Props) {
  const { t } = useTranslation();
  if (!turn) return null;
  const mine = turn.view !== "theirs";
  const color = mine ? myColor : partnerColor;

  return (
    <>
      {/* Spectating: the board steps back. Dimmed, not hidden. */}
      <motion.div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        initial={false}
        animate={{ opacity: mine ? 0 : 1 }}
        transition={{ duration: 0.35 }}
        style={{ background: "rgba(0,0,0,0.32)", zIndex: 7 }}
        data-testid="pair-spectator-dim"
      />

      {/* Your turn: the board lights up in your colour and breathes while
          the fence is still yours to draw; it holds steady once it is drawn. */}
      {mine && (
        <motion.div
          aria-hidden
          className="absolute inset-0 pointer-events-none rounded-sm"
          initial={{ opacity: 0 }}
          animate={turn.view === "yours" ? { opacity: [0.55, 1, 0.55] } : { opacity: 0.6 }}
          transition={turn.view === "yours" ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" } : { duration: 0.3 }}
          style={{
            border: `3px solid ${myColor}`,
            boxShadow: `0 0 24px ${myColor}aa, inset 0 0 30px ${myColor}55`,
            zIndex: 7,
          }}
          data-testid="pair-turn-glow"
        />
      )}

      {/* The tag. */}
      <div
        className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-background/90 px-3 py-1.5 text-sm shadow-lg whitespace-nowrap"
        style={{ border: `1.5px solid ${color}`, zIndex: 30 }}
        data-testid="pair-turn-tag"
        data-view={turn.view}
      >
        {turn.view === "yours" && (
          <>
            <PenLine className="w-4 h-4" style={{ color }} />
            <span className="font-bold" style={{ color }}>{t("pair.turn.yours")}</span>
            <span className="text-muted-foreground">{t("pair.turn.yoursHint")}</span>
            {onPass && (
              <button
                type="button"
                onClick={onPass}
                className="pointer-events-auto ml-1 flex items-center gap-1 rounded-full bg-muted hover:bg-muted/80 px-2 py-0.5 text-xs font-semibold"
              >
                <SkipForward className="w-3 h-3" /> {t("pair.turn.pass")}
              </button>
            )}
          </>
        )}
        {turn.view === "yoursSpent" && (
          <>
            <Hammer className="w-4 h-4" style={{ color }} />
            <span className="font-bold" style={{ color }}>{t("pair.turn.building")}</span>
            <span className="text-muted-foreground">{t("pair.turn.buildingHint", { name: partnerName })}</span>
          </>
        )}
        {turn.view === "theirs" && (
          <>
            <Eye className="w-4 h-4 text-muted-foreground" />
            <span className="font-bold text-muted-foreground">{t("pair.turn.spectating")}</span>
            <span style={{ color }}>{t("pair.turn.theirs", { name: partnerName })}</span>
          </>
        )}
      </div>

      {/* The hand-over, once, big. Keyed on the turn number so every change
          of hands plays it, and gone in a second so it never covers play. */}
      <AnimatePresence>
        {turn.view !== "yoursSpent" && (
          <motion.div
            key={turn.seq}
            aria-live="polite"
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{ zIndex: 31 }}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: [0, 1, 1, 0], scale: [0.8, 1, 1, 1.05] }}
            transition={{ duration: 1.3, times: [0, 0.15, 0.75, 1] }}
          >
            <div
              className="font-display text-3xl font-bold px-5 py-2 rounded-xl bg-background/80"
              style={{ color, textShadow: `0 0 18px ${color}` }}
            >
              {turn.view === "yours" ? t("pair.turn.splashYours") : t("pair.turn.splashTheirs", { name: partnerName })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
