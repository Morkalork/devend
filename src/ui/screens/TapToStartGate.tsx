/**
 * TapToStartGate - the startup splash, and the mobile-web audio unlock
 * (canvas port of components/game/TapToStartGate.tsx).
 *
 * It covers the first screen from the first frame until that screen has
 * finished loading (startupReadiness.ts): the menu's stats, unlocks and
 * certificates, the music list, and the background's config. Until then it
 * says "Loading..." and takes no tap, because tapping past it used to show
 * the menu still arriving - buttons popping in, the background redrawing - as
 * a flicker. A load that never finishes is not allowed to trap anyone: after
 * MAX_WAIT_MS it lets go regardless.
 *
 * Once loaded: browsers block audible sound until the first user gesture, so
 * where autoplay was actually blocked (isAwaitingUserGesture) it asks for a
 * tap, which unlocks audio, starts the menu loop, and dismisses it, so the
 * player lands on the welcome menu with music already playing. Where autoplay
 * is allowed (the installed Android app, a desktop browser with
 * media-engagement autoplay) it simply lifts on its own.
 *
 * On the canvas the tap is a Pixi pointer event, and Pixi dispatches those
 * synchronously from its own native `pointerup` listener (EventSystem binds it
 * on window, capture phase), so `onTap` runs inside the trusted DOM event's
 * call stack and the browser still counts it as a user activation.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isAudioUnlocked, isAwaitingUserGesture, startMenuMusic } from "@/lib/gameMusic";
import { useStartupReady } from "@/lib/startupReadiness";
import { Appear, Label, Pressable, ROLE, TEXT, View, hex, usePulse, useUiScreen } from "../kit/ui";
import { GameTitle } from "./welcomeParts";
import { AUDIO_DECISION_MS, MAX_WAIT_MS, SETTLE_MS, splashPhase, type SplashPhase } from "./tapToStartModel";

/**
 * The DOM gate unlocked on CLICK, not pointerdown: some browsers (notably iOS
 * Safari) only treat a completed tap (click) as a valid user-activation
 * gesture for <audio> playback. A canvas tap fires on pointerup, which Chrome
 * counts as activation but older Safari may not, so the unlock also runs once
 * more from the native click that follows the same tap. startMenuMusic is safe
 * to call twice: the loop is already the current track, play() on a playing
 * element is a no-op, and re-priming the partner element is harmless.
 */
function unlockOnFollowingClick(): void {
  const onClick = () => {
    window.removeEventListener("click", onClick, true);
    window.clearTimeout(timer);
    startMenuMusic();
  };
  // A tap's click lands within a few ms of its pointerup; stop waiting after a
  // second so a stray later click elsewhere never restarts anything.
  const timer = window.setTimeout(() => window.removeEventListener("click", onClick, true), 1000);
  window.addEventListener("click", onClick, true);
}

export function TapToStartGate({ accentColor, preview }: {
  accentColor?: string;
  /** Pin a phase, for the screen gallery: the live inputs cannot be forced from props. */
  preview?: Exclude<SplashPhase, "gone">;
}) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const ready = useStartupReady();
  const [settled, setSettled] = useState(false);
  const settledAt = useRef(0);
  const [tapped, setTapped] = useState(false);
  const [audio, setAudio] = useState(() => ({
    unlocked: isAudioUnlocked(), awaiting: isAwaitingUserGesture(), timedOut: false,
  }));
  const mountedAt = useRef(performance.now());

  // Ready, and still ready SETTLE_MS later (a part could only ever turn ready,
  // never back, but the menu's entrance needs the time). Or the hard cap.
  useEffect(() => {
    if (settled) {
      return;
    }
    const left = ready ? SETTLE_MS : Math.max(0, MAX_WAIT_MS - (performance.now() - mountedAt.current));
    const id = window.setTimeout(() => {
      settledAt.current = performance.now();
      setSettled(true);
    }, left);
    return () => window.clearTimeout(id);
  }, [ready, settled]);

  // playMainMusic() runs on the welcome mount and its autoplay rejection
  // resolves a tick later, so poll to learn whether a gesture is needed. Kept
  // up while the splash is: a tap swallowed during "Loading..." still counts
  // as the browser's gesture and unlocks audio, and then there is nothing left
  // to ask for, so the splash lifts by itself once loaded rather than asking
  // for a second tap. AUDIO_DECISION_MS after the settle with no answer,
  // autoplay was allowed (nothing to gate).
  const live = !tapped && !preview && !audio.unlocked && !(audio.timedOut && !audio.awaiting);
  useEffect(() => {
    if (!live) {
      return;
    }
    const id = setInterval(() => {
      const unlocked = isAudioUnlocked();
      const awaiting = isAwaitingUserGesture();
      const timedOut = settledAt.current > 0 && performance.now() - settledAt.current > AUDIO_DECISION_MS;
      setAudio(prev => (prev.unlocked === unlocked && prev.awaiting === awaiting && prev.timedOut === timedOut
        ? prev
        : { unlocked, awaiting, timedOut }));
    }, 150);
    return () => clearInterval(id);
  }, [live]);

  const phase = preview ?? splashPhase({
    settled, tapped,
    audioUnlocked: audio.unlocked, awaitingGesture: audio.awaiting, audioDecisionTimedOut: audio.timedOut,
  });

  const handleTap = () => {
    // Still loading: the tap is swallowed (nothing behind the splash may take
    // it either), and the splash stays.
    if (phase !== "tap" || preview) {
      return;
    }
    startMenuMusic();
    unlockOnFollowingClick();
    setTapped(true);
  };

  const accent = hex(accentColor || "#00ff88");
  // The prompt breathes from full to 35% opacity every 1.6s.
  const pulse = usePulse(1600, phase === "tap");

  if (phase === "gone") return null;
  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }} zIndex={9000}>
      {/* Opaque from its very first frame: a fade-in let the menu show through it. */}
      <Pressable
        onTap={handleTap}
        pressedAlpha={1}
        label={phase === "tap" ? t("welcome.tapToStart") : t("welcome.loading")}
        layout={{
          width: screen.width, height: screen.height, alignItems: "center", justifyContent: "center", gap: 40,
          backgroundColor: ROLE.surface,
        }}
      >
        <Appear fromScale={0.92} duration={0.5}>
          <GameTitle text="Dev/End" />
        </Appear>
        {/* Sentence case in the display face, like every label in the redo;
            the breathing is what says "tap", not shouting. While loading it is
            dim and still, so it does not read as a prompt. */}
        <Label
          text={phase === "tap" ? t("welcome.tapToStart") : t("welcome.loading")}
          font="display"
          size={TEXT.lg}
          weight="600"
          letterSpacing={1}
          color={phase === "tap" ? accent : ROLE.muted}
          alpha={phase === "tap" ? 1 - 0.65 * pulse : 0.6}
        />
      </Pressable>
    </View>
  );
}
