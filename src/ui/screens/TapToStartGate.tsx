/**
 * TapToStartGate - mobile-web audio unlock (canvas port of
 * components/game/TapToStartGate.tsx).
 *
 * Browsers block audible sound until the first user gesture, so on the deployed
 * web build the menu track can't autoplay. This full-screen "tap to start" gate
 * appears only when autoplay was actually blocked (see isAwaitingUserGesture);
 * the first tap unlocks audio, starts the menu loop, and dismisses the gate, so
 * the player lands on the welcome menu with music already playing.
 *
 * It never shows where autoplay is allowed (the installed Android app, or a
 * desktop browser with media-engagement autoplay) because audio unlocks there
 * without a gesture.
 *
 * On the canvas the tap is a Pixi pointer event, and Pixi dispatches those
 * synchronously from its own native `pointerup` listener (EventSystem binds it
 * on window, capture phase), so `onTap` runs inside the trusted DOM event's
 * call stack and the browser still counts it as a user activation.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { isAudioUnlocked, isAwaitingUserGesture, startMenuMusic } from "@/lib/gameMusic";
import { Appear, Label, Pressable, ROLE, TEXT, View, hex, usePulse, useUiScreen } from "../kit/ui";
import { GameTitle } from "./welcomeParts";

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

export function TapToStartGate({ accentColor }: { accentColor?: string }) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const [show, setShow] = useState(false);

  // playMainMusic() runs on the welcome mount and its autoplay rejection resolves
  // a tick later, so poll briefly to learn whether a gesture is needed. Stop as
  // soon as it's decided (shown, or already unlocked), and give up after a few
  // seconds where autoplay was allowed (nothing to gate).
  useEffect(() => {
    if (isAudioUnlocked()) return;
    let ticks = 0;
    const id = setInterval(() => {
      if (isAudioUnlocked()) { setShow(false); clearInterval(id); return; }
      if (isAwaitingUserGesture()) { setShow(true); clearInterval(id); return; }
      if (++ticks > 30) clearInterval(id); // ~4.5s: autoplay allowed, no gate needed
    }, 150);
    return () => clearInterval(id);
  }, []);

  const handleStart = () => {
    startMenuMusic();
    unlockOnFollowingClick();
    setShow(false);
  };

  const accent = hex(accentColor || "#00ff88");
  // The prompt breathes from full to 35% opacity every 1.6s.
  const pulse = usePulse(1600, show);

  if (!show) return null;
  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }} zIndex={9000}>
      <Appear layout={{ width: screen.width, height: screen.height }}>
        <Pressable
          onTap={handleStart}
          pressedAlpha={1}
          label={t("welcome.tapToStart")}
          layout={{
            width: screen.width, height: screen.height, alignItems: "center", justifyContent: "center", gap: 40,
            backgroundColor: ROLE.surface,
          }}
        >
          <Appear fromScale={0.92} duration={0.5}>
            <GameTitle text="Dev/End" />
          </Appear>
          {/* Sentence case in the display face, like every label in the redo;
              the breathing is what says "tap", not shouting. */}
          <Label
            text={t("welcome.tapToStart")}
            font="display"
            size={TEXT.lg}
            weight="600"
            letterSpacing={1}
            color={accent}
            alpha={1 - 0.65 * pulse}
          />
        </Pressable>
      </Appear>
    </View>
  );
}
