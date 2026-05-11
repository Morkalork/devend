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
}
