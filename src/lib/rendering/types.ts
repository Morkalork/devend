import { GameModifiers } from "@/hooks/useActiveModifiers";

export interface RainParticle {
  x: number;
  y: number;
  symbol: string;
  alpha: number;
  speed: number;
  size: number;
}

export interface RainState {
  particles: RainParticle[];
  /** Timestamp (ms) of the last frame — mutated by renderFrame each call. */
  lastTime: number;
}

export interface RenderContext {
  accentColor: string;
  activeModifiers: GameModifiers;
  boardGridCanvas: OffscreenCanvas;
  regionCanvas: OffscreenCanvas;
  rain: RainState;
  /** Level threshold (% space remaining when level completes) — for progress bar. */
  spaceThreshold: number;
  /** Admin/Playground: draw a live speed label above each ball. */
  showBallSpeeds?: boolean;
  /** Admin/Playground: draw the frame-time HUD (read by the Pixi renderer;
   *  the 2D path draws its overlay separately via drawPerfOverlay). */
  showPerfOverlay?: boolean;
  /** Localized "Info Unlocked" text flashed above a ball on its first-ever
   *  lock of that ball type. renderFrame.ts has no i18n of its own, so the
   *  already-translated string is threaded in here. Falls back to English. */
  infoUnlockedLabel?: string;
  /** Localized pickup claim labels (same threading rationale as above).
   *  `overtime` needs none (the renderers format "+Nh" from the feedback
   *  value); capRaise may contain a `{n}` placeholder for its hours. */
  pickupLabels?: { fork?: string; capRaise?: string; freezeCharge?: string; freeShopItem?: string };
}
