/**
 * What the play screen's control row and its popup menu contain, and what each
 * entry does, exactly as GameScreen's inline DOM row wired them. Pure, so the
 * order, the conditions and the close-the-menu rules are testable.
 */
import {
  Menu, Home, RotateCcw, Pause, Play, Volume2, VolumeX, Target, SlidersHorizontal, ClipboardList,
  type LucideIcon,
} from "lucide-react";

export interface ControlsRowProps {
  accentColor: string;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  canPause: boolean;
  isPaused: boolean;
  onTogglePause: () => void;
  manualUnread: number;
  onOpenSpecs: () => void;
  onOpenWin: () => void;
  soundMuted: boolean;
  onToggleSound: () => void;
  adminMode: boolean;
  onOpenTuning: () => void;
  onRestart: () => void;
  onMainMenu: () => void;
}

/** A string to show: an i18n key, or a literal (the admin-only "Tune map" was never translated). */
export type ControlText = { key: string; values?: Record<string, unknown> } | { literal: string };

export interface ControlButton {
  id: "menu" | "pause" | "specs" | "win";
  icon: LucideIcon;
  iconSize: number;
  strokeWidth?: number;
  /** Lit (accent wash) rather than the dark fill: the menu while open, pause while paused. */
  active: boolean;
  /** What a screen reader would have read (the DOM's aria-label). */
  label: ControlText;
  /** The Specs badge: manual entries filed and not yet read. */
  badge: number | null;
  onTap: () => void;
}

/** Menu, Pause/Play (when the map can pause), Specs, Win: every control the map has, in the thumb zone. */
export function controlButtons(p: ControlsRowProps): ControlButton[] {
  const out: ControlButton[] = [
    { id: "menu", icon: Menu, iconSize: 20, active: p.menuOpen, label: { key: "game.gameMenu" }, badge: null, onTap: p.onToggleMenu },
  ];
  if (p.canPause) {
    out.push({
      id: "pause", icon: p.isPaused ? Play : Pause, iconSize: 16, active: p.isPaused,
      label: { key: p.isPaused ? "game.resume" : "game.pause" }, badge: null,
      // Pausing also closes the menu.
      onTap: () => { p.onCloseMenu(); p.onTogglePause(); },
    });
  }
  out.push(
    {
      id: "specs", icon: ClipboardList, iconSize: 20, strokeWidth: 1.5, active: false,
      label: { key: "topBar.specs" },
      // A new mechanic has been filed in the Manual. The badge replaced the
      // modal that used to announce one, so the player learns something is
      // there without losing the frame they were playing.
      badge: p.manualUnread > 0 ? p.manualUnread : null,
      onTap: p.onOpenSpecs,
    },
    { id: "win", icon: Target, iconSize: 20, active: false, label: { key: "winConditions.menuItem" }, badge: null, onTap: p.onOpenWin },
  );
  return out;
}

/** The Specs badge's own label (the DOM's aria-label on it). */
export function specsBadgeLabel(count: number): ControlText {
  return { key: "topBar.specsNew", values: { count } };
}

export interface MenuItem {
  id: "sound" | "win" | "tuning" | "restart" | "mainMenu";
  icon: LucideIcon;
  text: ControlText;
  /** null = the board's accent. */
  color: number | null;
  onTap: () => void;
}

/**
 * The popup's entries, top to bottom. Every entry but sound closes the menu
 * first: sound toggles in place so the player can hear the change and flip it
 * back. Tune map only in admin.
 */
export function menuItems(p: ControlsRowProps): MenuItem[] {
  const closing = (fn: () => void) => () => { p.onCloseMenu(); fn(); };
  const items: MenuItem[] = [
    {
      id: "sound", icon: p.soundMuted ? VolumeX : Volume2,
      text: { key: p.soundMuted ? "game.soundOff" : "game.soundOn" }, color: null, onTap: p.onToggleSound,
    },
    { id: "win", icon: Target, text: { key: "winConditions.menuItem" }, color: null, onTap: closing(p.onOpenWin) },
  ];
  if (p.adminMode) {
    items.push({ id: "tuning", icon: SlidersHorizontal, text: { literal: "Tune map" }, color: null, onTap: closing(p.onOpenTuning) });
  }
  items.push(
    { id: "restart", icon: RotateCcw, text: { key: "game.restartRun" }, color: null, onTap: closing(p.onRestart) },
    { id: "mainMenu", icon: Home, text: { key: "game.mainMenu" }, color: null, onTap: closing(p.onMainMenu) },
  );
  return items;
}

/** Apple's 44px minimum: these were once 32px, a control you miss while a ball is moving. */
export const CONTROL_TARGET = 44;

/** Space between the row's top and the popup's bottom edge (the DOM's mb-2). */
export const MENU_GAP = 8;
