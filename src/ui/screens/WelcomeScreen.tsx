/**
 * The main menu (canvas port of components/game/WelcomeScreen.tsx). Same
 * props, same buttons in the same order, the same loading and error states,
 * the first-time highlights, the Daily Stand-up intro, the "certificates are
 * locked" explainer and the secret admin unlock on the spinning ball.
 *
 * Which buttons show and how each looks is decided in welcomeModel.ts; this
 * file only draws it. In the redo (UI_REDO_PLAN.md, phase 3) it is left-
 * aligned: the logo, the way into a run as a filled button, and the rest of
 * the menu as a plain list of rows. The CRT backdrop and the memory parallax are not drawn
 * here: they are rendered once, globally, underneath the interface canvas.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle, Sparkles, Hexagon, Trophy, Backpack, Medal, CalendarDays, Flame, Check, Music, Users,
  ChevronRight, GraduationCap, Lock, Settings, Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { version } from "@/lib/version";
import type { MenuHighlightFlags, MenuHighlightKey } from "@/hooks/useMenuHighlights";
import {
  Appear, COLOR, GOLD, Icon, Label, Modal, Pressable, RADIUS, ROLE, ScrollView, TEXT, View, hex, tint, useUiScreen,
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
  tutorial: GraduationCap,
  options: Settings,
  admin: Wrench,
  daily: CalendarDays,
  twoPlayer: Users,
  certificates: Sparkles,
  loadouts: Backpack,
  records: Medal,
  achievements: Trophy,
  jukebox: Music,
};

/** The buttons that start or resume a run; the rest of the menu is a list. */
const PLAY_IDS: readonly WelcomeButtonId[] = ["continue", "newGame"];

/** The streak chip's amber, and a sub-line under a label. */
const AMBER_INK = 0xffb347;

export function WelcomeScreen({
  onStartGame,
  onContinue,
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

  const columnWidth = Math.min(420, screen.width - 32);
  const accent = accentColor ? hex(accentColor) : COLOR.primary;
  const textSize = arcadeTextSize("md");

  // The two ways into a run are buttons; everything else is a row in the list.
  const playButtons = buttons.filter(b => PLAY_IDS.includes(b.id));
  const menuRows = buttons.filter(b => !PLAY_IDS.includes(b.id));

  const renderButton = (spec: WelcomeButtonSpec) => {
    const ink = arcadeInk(spec.variant, spec.locked);
    const label = spec.label ? t(spec.label.key, spec.label.vars) : undefined;
    const small = (s: string, size: number, color: number) => (
      <Label text={s} size={size} font="display" weight="600" upper letterSpacing={size * 0.1} color={color} />
    );
    return (
      <ArcadeButton
        key={spec.id}
        size="md"
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
            {spec.sub && small(t(spec.sub.key, spec.sub.vars), 10, AMBER_INK)}
            {spec.badge && <NewBadge />}
            {spec.chip?.kind === "streak" && <MenuChip text={String(spec.chip.value)} icon={Flame} iconColor={AMBER_INK} />}
            {spec.chip?.kind === "hours" && <MenuChip text={t("welcome.hoursSuffix", { hours: spec.chip.value })} icon={Hexagon} />}
            {spec.chip?.kind === "count" && <MenuChip text={String(spec.chip.value)} />}
            {spec.check && <Icon icon={Check} size={16} color={COLOR.primary} />}
          </>
        ) : undefined}
      </ArcadeButton>
    );
  };

  // One row of the menu list: icon, label, whatever the button carried
  // (streak, hours, count, check, NEW), and a chevron. No box: the rule
  // between rows is the only edge, so the filled play button stays the one
  // thing on the screen that reads as "press me".
  const renderRow = (spec: WelcomeButtonSpec, i: number) => {
    const label = spec.label ? t(spec.label.key, spec.label.vars) : t("welcome.loading");
    const ink = spec.locked ? ROLE.muted : ROLE.ink;
    const icon = BUTTON_ICON[spec.id];
    return (
      <Pressable
        key={spec.id}
        label={label}
        onTap={() => press(spec)}
        disabled={spec.disabled}
        // Admin is a dev door, not a menu item: it sits dimmed.
        alpha={(spec.id === "admin" ? 0.7 : 1) * (spec.locked ? 0.6 : 1)}
        layout={{ flexDirection: "row", alignItems: "center", gap: 12, alignSelf: "stretch", paddingTop: 14, paddingBottom: 14 }}
      >
        {i > 0 && <View layout={{ position: "absolute", left: 0, right: 0, top: 0, height: 1, backgroundColor: ROLE.edge }} />}
        {icon && <Icon icon={icon} size={18} color={spec.ring ? GOLD : ROLE.muted} />}
        <View layout={{ flex: 1, flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: 6, rowGap: 4 }}>
          <Label text={label} size={TEXT.base} font="display" weight="600" color={spec.ring ? GOLD : ink} />
          {spec.badge && <NewBadge />}
        </View>
        {spec.chip?.kind === "streak" && <MenuChip text={String(spec.chip.value)} icon={Flame} iconColor={AMBER_INK} />}
        {spec.chip?.kind === "hours" && <MenuChip text={t("welcome.hoursSuffix", { hours: spec.chip.value })} icon={Hexagon} iconColor={ROLE.hours} />}
        {spec.chip?.kind === "count" && <MenuChip text={String(spec.chip.value)} />}
        {spec.check && <Icon icon={Check} size={16} color={COLOR.primary} />}
        <Icon icon={spec.locked ? Lock : ChevronRight} size={16} color={ROLE.muted} />
      </Pressable>
    );
  };

  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, backgroundColor: tint(ROLE.surface, 0.9) }}>
      <ScrollView layout={{ flex: 1 }}>
        <View layout={{ minHeight: screen.height, paddingTop: 40, paddingBottom: 40, alignItems: "center", justifyContent: "center" }}>
          <Appear fromY={12} duration={0.4} layout={{ width: columnWidth, gap: 28 }}>
            {/* The logo and the tagline, left-aligned, with the spinning ball
                beside them (it wraps under them on a narrow phone). The ball
                doubles as a secret admin unlock: 10 quick taps (deployed dev only). */}
            <View layout={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", rowGap: 12 }}>
              <View layout={{ alignItems: "flex-start", gap: 8 }}>
                <GameTitle text="Dev/End" size={40} />
                <Label text={t("welcome.tagline")} size={TEXT.base} color={ROLE.muted} />
              </View>
              <MenuBall onTap={() => secretRef.current?.tap()} />
            </View>

            {/* Error state */}
            {error && (
              <View layout={{
                alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 8, padding: 12,
                borderRadius: RADIUS.sm, backgroundColor: tint(ROLE.cost, 0.1), borderWidth: 1, borderColor: tint(ROLE.cost, 0.4),
              }}>
                <Icon icon={AlertCircle} size={18} color={ROLE.cost} />
                <View layout={{ flex: 1 }}>
                  <Label text={error} size={TEXT.sm} color={ROLE.cost} wrap />
                </View>
              </View>
            )}

            {/* Into a run: the recommended one is the screen's only filled button. */}
            <Appear fromY={10} delay={0.1} layout={{ gap: 12 }}>
              {playButtons.map(renderButton)}
            </Appear>

            {/* Everything else, as a list. */}
            <Appear fromY={10} delay={0.2}>
              {menuRows.map(renderRow)}
            </Appear>
          </Appear>
        </View>
      </ScrollView>

      <View layout={{ position: "absolute", right: 16, bottom: 12 }} alpha={0.3}>
        <Label text={`v${version}`} size={TEXT.xs} font="mono" color={ROLE.muted} />
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
