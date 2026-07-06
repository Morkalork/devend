/**
 * Rain Glyph Cache
 *
 * The ambient data-rain draws 40 particles every frame. Doing that with
 * ctx.fillText means 40 text-shaping/rasterization calls per frame — one of the
 * slowest Canvas2D operations on a mobile WebView, and a fixed tax that runs
 * regardless of ball count. The rain uses a small fixed alphabet (RAIN_SYMBOLS)
 * at a single font size (14 * scale) in one colour (the level accent), so each
 * distinct glyph is pre-rendered ONCE to a tiny OffscreenCanvas and blitted with
 * drawImage — the 40 shaping calls become 40 cheap blits, opacity handled by the
 * caller via globalAlpha.
 *
 * The glyph is drawn at (PAD, PAD) with textBaseline 'top'; blitting the sprite
 * at (x - PAD, y - PAD) lands its pixels exactly where fillText(symbol, x, y)
 * would have, so the look is pixel-identical.
 *
 * Cache key: `${symbol}|${color}|${fontPx}`. During a level colour and font size
 * are fixed, so this is build-once per symbol. Cleared on resize/teardown.
 */

interface RainGlyphEntry {
  canvas: OffscreenCanvas;
  /** Padding baked around the glyph; subtract from the draw position on blit. */
  pad: number;
}

const PAD = 2;
const glyphCache = new Map<string, RainGlyphEntry>();

/**
 * Return (building if needed) a pre-rendered glyph sprite. Blit it at
 * `(drawX - entry.pad, drawY - entry.pad)` to match `fillText(symbol, drawX, drawY)`
 * with `textBaseline = 'top'`.
 */
export function getRainGlyph(symbol: string, color: string, fontPx: number): RainGlyphEntry {
  const key = `${symbol}|${color}|${fontPx}`;
  const existing = glyphCache.get(key);
  if (existing) return existing;

  // Generous box so no glyph (tall braces, descenders) is ever clipped.
  const w = Math.ceil(fontPx * 1.4) + PAD * 2;
  const h = Math.ceil(fontPx * 1.6) + PAD * 2;
  const oc = new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  const c = oc.getContext("2d")!;
  c.font = `${fontPx}px 'JetBrains Mono', monospace`;
  c.textBaseline = "top";
  c.fillStyle = color;
  c.fillText(symbol, PAD, PAD);

  const entry: RainGlyphEntry = { canvas: oc, pad: PAD };
  glyphCache.set(key, entry);
  return entry;
}

/** Drop all cached glyphs — call on resize (font size changes) and teardown. */
export function clearRainGlyphCache(): void {
  glyphCache.clear();
}
