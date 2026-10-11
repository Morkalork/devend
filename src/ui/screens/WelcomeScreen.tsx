/**
 * The main menu (canvas port of components/game/WelcomeScreen.tsx). Same
 * props, same buttons in the same order, the same loading and error states,
 * the first-time highlights, the Daily Stand-up intro, the "certificates are
 * locked" explainer and the secret admin unlock on the spinning ball.
 *
 * Which buttons show and how each looks is decided in welcomeModel.ts; this
 * file only draws it. The CRT backdrop and the memory parallax are not drawn
 * here: they are rendered once, globally, underneath the interface canvas.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle, Sparkles, Hexagon, Trophy, Backpack, Medal, CalendarDays, Flame, Check, Music, Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { version } from "@/lib/version";
import type { MenuHighlightFlags, MenuHighlightKey } from "@/hooks/useMenuHighlights";
import {
  Appear, COLOR, Icon, Label, Modal, RADIUS, ScrollView, TEXT, View, hex, tint, useUiScreen,
} from "../kit/ui";
import {
  certificatesTapAction, createSecretTapCounter, dailyTapAction, highlightToAck, welcomeButtons,
  type WelcomeButtonId, type WelcomeButtonSpec,
} from "./welcomeModel";
import { GameTitle, MenuBall, MenuChip, NewBadge, Spinner } from "./welcomeParts";
import { ArcadeButton } from "../kit/ui";
import { arcadeInk, arcadeTextSize } from "../kit/ui";

interface WelcomeScreenProps {
  onStartGame: () => void;
  /** When a saved run exists, resumes it. Absent = no save (single Start Game button). */
  onContinue?: () => void;
  /**
   * Ascension depth of the saved run, 0 for an unascended one. Shown on the
   * Continue button so the menu says which run is waiting: at depth the rules
   * differ enough that resuming blind is a genuine surprise.
   */
  savedRunAscension?: number;
  onTutorial: () => void;
  onOptions: () => void;
  onOpenCertificateStore?: () => void;
  onLoadouts?: () => void;
  /** Opens the Performance Review (records). Absent until a run has banked. */
  onHallOfFame?: () => void;
  /** Starts today's seeded Daily Stand-up run (HIGHSCORES.md Phase D). */
  onDaily?: () => void;
  /** First tap on Daily Stand-up shows an intro modal before the run starts. */
  showDailyIntro?: boolean;
  /** Marks the Daily Stand-up intro as seen (persisted tutorial flag). */
  onDailyIntroSeen?: () => void;
  /**
   * Opens the 2-Player lobby (TWO_PLAYER_PLAN.md). Absent = the mode is off.
   */
  onTwoPlayer?: () => void;
  /**
   * The partner's name when a pair run is waiting on THIS phone, so the button
   * says which it is before anyone scans anything. The choice itself still
   * waits for the connection, because Continue or New is a decision for two.
   */
  pairPartnerName?: string;
  /** Attendance streak shown on the daily button (0 = hidden). */
  dailyStreak?: number;
  /** True when today's stand-up already has a banked run (shows a check). */
  dailyDoneToday?: boolean;
  onAchievements?: () => void;
  /** Opens the Jukebox (music credits + playlist). Absent if music.yml failed. */
  onJukebox?: () => void;
  onAdmin?: () => void;
  /** Secret gesture: tapping the animated ball 10x unlocks admin (deployed dev). */
  onSecretUnlock?: () => void;
  isLoading?: boolean;
  error?: string | null;
  accentColor?: string;
  totalCertificateHours?: number;
  completedAchievementCount?: number;
  /** First-time highlights: which buttons get the gold ring + NEW badge. */
  highlights?: Partial<MenuHighlightFlags>;
  /** Called when a highlighted button is tapped, clearing its highlight. */
  onHighlightSeen?: (key: MenuHighlightKey) => void;
}

/** The leading icon of each menu button that has one. */
const BUTTON_ICON: Partial<Record<WelcomeButtonId, LucideIcon>> = {
  daily: CalendarDays,
  twoPlayer: Users,
  certificates: Sparkles,
  loadouts: Backpack,
  records: Medal,
  achievements: Trophy,
  jukebox: Music,
};

/** The ascension line under Continue (#ffb347, the ladder's amber). */
const ASCENSION_INK = 0xffb347;

export function WelcomeScreen({
  onStartGame,
  onContinue,
  savedRunAscension = 0,
  onTutorial,
  onOptions,
  onOpenCertificateStore,
  onLoadouts,
  onHallOfFame,
  onDaily,
  onTwoPlayer,
  pairPartnerName,
  showDailyIntro = false,
  onDailyIntroSeen,
  dailyStreak = 0,
  dailyDoneToday = false,
  onAchievements,
  onJukebox,
  onAdmin,
  onSecretUnlock,
  isLoading,
  error,
  accentColor,
  totalCertificateHours,
  completedAchievementCount,
  highlights,
  onHighlightSeen,
}: WelcomeScreenProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();

  // Secret admin unlock: 10 quick taps on the animated ball (deployed dev); a
  // >1.2s gap resets the count, so it's deliberate. The latest callback is read
  // at tap time.
  const unlockRef = useRef(onSecretUnlock);
  unlockRef.current = onSecretUnlock;
  const secretRef = useRef<ReturnType<typeof createSecretTapCounter> | null>(null);
  if (!secretRef.current) secretRef.current = createSecretTapCounter(() => unlockRef.current);
  useEffect(() => () => secretRef.current?.dispose(), []);

  const [showCertInfo, setShowCertInfo] = useState(false);
  const [showDailyInfo, setShowDailyInfo] = useState(false);

  const buttons = welcomeButtons({
    hasContinue: !!onContinue,
    savedRunAscension,
    hasDaily: !!onDaily,
    hasTwoPlayer: !!onTwoPlayer,
    pairPartnerName,
    dailyStreak,
    dailyDoneToday,
    hasCertificateStore: !!onOpenCertificateStore,
    hasLoadouts: !!onLoadouts,
    hasHallOfFame: !!onHallOfFame,
    hasAchievements: !!onAchievements,
    hasJukebox: !!onJukebox,
    hasAdmin: !!onAdmin,
    isLoading,
    totalCertificateHours,
    completedAchievementCount,
    highlights,
  });

  const press = (spec: WelcomeButtonSpec) => {
    // Tapping a highlighted button acknowledges its first-time highlight.
    const ack = highlightToAck(spec, highlights);
    if (ack) onHighlightSeen?.(ack);
    switch (spec.id) {
      case "continue": onContinue?.(); break;
      case "newGame": onStartGame(); break;
      case "daily":
        // First visit: explain what the Daily Stand-up is before the run
        // starts. Afterwards the button launches straight in.
        if (dailyTapAction(showDailyIntro) === "intro") setShowDailyInfo(true);
        else onDaily?.();
        break;
      case "twoPlayer": onTwoPlayer?.(); break;
      case "tutorial": onTutorial(); break;
      case "options": onOptions(); break;
      case "certificates":
        if (certificatesTapAction(!!onOpenCertificateStore) === "store") onOpenCertificateStore?.();
        else setShowCertInfo(true);
        break;
      case "loadouts": onLoadouts?.(); break;
      case "records": onHallOfFame?.(); break;
      case "achievements": onAchievements?.(); break;
      case "jukebox": onJukebox?.(); break;
      case "admin": onAdmin?.(); break;
    }
  };

  const columnWidth = Math.min(320, screen.width - 48);
  const accent = accentColor ? hex(accentColor) : COLOR.primary;
  const textSize = arcadeTextSize("sm");

  const renderButton = (spec: WelcomeButtonSpec) => {
    const ink = arcadeInk(spec.variant, spec.locked);
    const label = spec.label ? t(spec.label.key, spec.label.vars) : undefined;
    const small = (s: string, size: number, color: number) => (
      <Label text={s} size={size} font="display" weight="600" upper letterSpacing={size * 0.1} color={color} />
    );
    return (
      <ArcadeButton
        key={spec.id}
        size="sm"
        variant={spec.variant}
        onTap={() => press(spec)}
        disabled={spec.disabled}
        ring={spec.ring}
        glow={spec.glow}
        pulse={spec.pulse}
        shimmer={spec.shimmer}
        locked={spec.locked}
        column={spec.id === "continue" && !spec.loading}
        // Admin is a dev door, not a menu item: it sits dimmed (opacity-70).
        alpha={spec.id === "admin" ? 0.7 : 1}
        label={label ?? t("welcome.loading")}
        layout={{ alignSelf: "stretch" }}
        // The label wraps if the row runs out of room (a long translation on
        // a narrow phone), so the chips after it never run off the button.
        text={spec.loading ? undefined : label}
        icon={spec.loading ? undefined : BUTTON_ICON[spec.id]}
      >
        {spec.loading ? (
          <>
            <Spinner size={20} color={ink} />
            {small(t("welcome.loading"), textSize, ink)}
          </>
        ) : (spec.sub || spec.badge || spec.chip || spec.check) ? (
          <>
            {spec.sub && small(t(spec.sub.key, spec.sub.vars), 10, ASCENSION_INK)}
            {spec.badge && <NewBadge />}
            {spec.chip?.kind === "streak" && <MenuChip text={String(spec.chip.value)} icon={Flame} iconColor={ASCENSION_INK} />}
            {spec.chip?.kind === "hours" && <MenuChip text={t("welcome.hoursSuffix", { hours: spec.chip.value })} icon={Hexagon} />}
            {spec.chip?.kind === "count" && <MenuChip text={String(spec.chip.value)} />}
            {spec.check && <Icon icon={Check} size={16} color={COLOR.primary} />}
          </>
        ) : undefined}
      </ArcadeButton>
    );
  };

  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, backgroundColor: tint(COLOR.background, 0.85) }}>
      {/* The two drifting blurred blobs behind the menu (bg-primary/5 blur-3xl)
          are dropped: at 5% opacity under a blur they were all but invisible. */}
      <ScrollView layout={{ flex: 1 }}>
        <View layout={{ minHeight: screen.height, padding: 24, alignItems: "center", justifyContent: "center" }}>
          <Appear fromY={20} duration={0.6} layout={{ alignItems: "center", gap: 48 }}>
            {/* Title */}
            <Appear fromScale={0.9} duration={0.5} delay={0.2} layout={{ alignItems: "center" }}>
              <GameTitle text="Dev/End" />
              <Appear delay={0.5} layout={{ marginTop: 16 }}>
                <Label text={t("welcome.tagline")} size={TEXT.lg} color={COLOR.mutedForeground} letterSpacing={0.45} />
              </Appear>
            </Appear>

            {/* Animated spinning ball preview. Doubles as a secret admin
                unlock: 10 quick taps (deployed dev only). */}
            <MenuBall onTap={() => secretRef.current?.tap()} />

            {/* Error state */}
            {error && (
              <Appear fromY={10}>
                <View layout={{
                  width: columnWidth, flexDirection: "row", alignItems: "center", gap: 8, padding: 16,
                  borderRadius: RADIUS.lg, backgroundColor: tint(COLOR.destructive, 0.1),
                  borderWidth: 1, borderColor: tint(COLOR.destructive, 0.2),
                }}>
                  <Icon icon={AlertCircle} size={20} color={COLOR.destructive} />
                  <View layout={{ flex: 1 }}>
                    <Label text={error} size={TEXT.sm} color={COLOR.destructive} wrap />
                  </View>
                </View>
              </Appear>
            )}

            {/* Buttons */}
            <Appear fromY={20} delay={0.4} layout={{ width: columnWidth, gap: 20 }}>
              {buttons.map(renderButton)}
            </Appear>
          </Appear>
        </View>
      </ScrollView>

      <View layout={{ position: "absolute", right: 16, bottom: 12 }} alpha={0.3}>
        <Label text={`v${version}`} size={TEXT.xs} font="mono" color={0x00ff88} />
      </View>

      {/* Explainer shown when certificates aren't unlocked yet. Tapping the
          backdrop or the X closes it. */}
      {showCertInfo && (
        <Modal screen={screen} onClose={() => setShowCertInfo(false)} accent={accent} maxWidth={384}>
          <InfoBody icon={Sparkles} title={t("welcome.certLockedTitle")} body={t("welcome.certLockedBody")} />
          <ArcadeButton size="sm" text={t("welcome.certLockedGotIt")} onTap={() => setShowCertInfo(false)} layout={{ marginTop: 8 }} />
        </Modal>
      )}

      {/* First-time Daily Stand-up intro. It gates the run: the only way
          forward is "Start", so a player always sees the explanation before
          playing. Backdrop/X cancels (leaves the flag unset) so it returns
          next tap. */}
      {showDailyInfo && (
        <Modal screen={screen} onClose={() => setShowDailyInfo(false)} accent={accent} maxWidth={384}>
          <InfoBody icon={CalendarDays} title={t("welcome.dailyIntroTitle")} body={t("welcome.dailyIntroBody")} />
          <ArcadeButton
            size="sm"
            text={t("welcome.dailyIntroStart")}
            onTap={() => {
              setShowDailyInfo(false);
              onDailyIntroSeen?.();
              onDaily?.();
            }}
            layout={{ marginTop: 8 }}
          />
        </Modal>
      )}
    </View>
  );
}

/** An explainer card's icon + heading row and its body (line breaks kept). */
function InfoBody({ icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <>
      <View layout={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Icon icon={icon} size={28} color={COLOR.primary} />
        <View layout={{ flex: 1 }}>
          <Label text={title} size={TEXT.base} weight="700" wrap />
        </View>
      </View>
      <Label text={body} size={TEXT.sm} color={COLOR.mutedForeground} wrap />
    </>
  );
}
