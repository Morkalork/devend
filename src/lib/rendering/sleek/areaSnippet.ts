/**
 * The code snippet a Syntax Highlighting area shows, baked to a texture.
 *
 * A zone reads as a patch of editor: its kind's theme (light or dark) and an
 * HTML lock tag around its payout, which becomes assembly once a ball is
 * locked in (areaSnippet). Drawn once per kind, state and font size into a
 * canvas and cached as a Texture, so the area layer only positions a Sprite.
 * It used to create two pixi Text objects per zone on every rebuild of that
 * layer, which on a tilting gravity map was every frame.
 *
 * The fit (snippetFontPx) is split from the canvas work so the fit can be
 * tested without a canvas.
 */
import { Texture } from "pixi.js";
import { areaSnippet, areaStyle, type SnippetToken } from "@/lib/coloredAreas";
import type { AreaKind } from "@/types/level";

/** Monospace advance as a share of the font size, for JetBrains Mono. */
export const MONO_ADVANCE = 0.6;
/** Line height as a share of the font size. */
export const LINE_HEIGHT = 1.3;
/** Never smaller than this (physical px) - below it the code is noise. */
export const MIN_FONT_PX = 7;
/** Never larger, so a huge zone still reads as code rather than a banner. */
export const MAX_FONT_PX = 72;
/** How much of the zone the snippet may take, each way. */
export const FIT_SHARE = 0.9;
/** Breathing room kept around the code, as a share of the font size. */
export const TEXT_PAD = 0.45;

/** The font size that fills a zone of w x h px with the snippet. */
export function snippetFontPx(lines: SnippetToken[][], w: number, h: number): number {
  const cols = Math.max(1, ...lines.map(l => l.reduce((n, t) => n + t.text.length, 0)));
  const byWidth = (w * FIT_SHARE) / (cols * MONO_ADVANCE + TEXT_PAD * 2);
  const byHeight = (h * FIT_SHARE) / (lines.length * LINE_HEIGHT + TEXT_PAD * 2);
  return Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, Math.floor(Math.min(byWidth, byHeight))));
}

const cache = new Map<string, Texture>();
const FONT = "'JetBrains Mono', 'Fira Code', monospace";

/**
 * The snippet texture for a kind, state and font size, built once and reused.
 *
 * Transparent around the glyphs: the area layer fills the whole zone with the
 * theme's editor background, and the code is sized to fill that editor. A
 * version that put the code on its own small chip left most of the zone
 * showing the board, which read as a sticker on a coloured box, not a zone.
 */
export function snippetTexture(kind: AreaKind, locked: boolean, fontPx: number): Texture {
  const key = `${kind}|${locked ? "asm" : "html"}|${fontPx}`;
  const hit = cache.get(key);
  if (hit) {
    return hit;
  }
  const lines = areaSnippet(kind, locked);
  const theme = areaStyle(kind).theme;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return Texture.WHITE;
  }
  // Size from the measured text, not the monospace estimate, so a fallback
  // font that runs wider still fits its own chip.
  ctx.font = `${fontPx}px ${FONT}`;
  const textW = Math.max(...lines.map(l => ctx.measureText(l.map(t => t.text).join("")).width));
  const pad = Math.ceil(fontPx * TEXT_PAD);
  const lineH = Math.ceil(fontPx * LINE_HEIGHT);
  canvas.width = Math.ceil(textW) + pad * 2;
  canvas.height = lineH * lines.length + pad * 2;
  // Resizing a canvas resets its context state.
  ctx.font = `${fontPx}px ${FONT}`;
  ctx.textBaseline = "top";
  lines.forEach((line, row) => {
    let x = pad;
    for (const token of line) {
      ctx.fillStyle = theme[token.role];
      ctx.fillText(token.text, x, pad + row * lineH + (lineH - fontPx) / 2);
      x += ctx.measureText(token.text).width;
    }
  });
  const tex = Texture.from(canvas);
  cache.set(key, tex);
  return tex;
}
