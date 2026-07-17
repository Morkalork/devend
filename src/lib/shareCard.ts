/**
 * shareCard — renders a run summary as a PNG-able canvas (HIGHSCORES.md
 * Phase E). The result screen offers it via the Web Share API where available
 * (mobile), else as a download. No servers involved: the card IS the
 * leaderboard post.
 */

export interface ShareCardData {
  score: number;
  levelNumber: number;
  ascensionDepth: number;
  buildLine: string;
  capstoneName: string | null;
  rank: number | null;
  dailyKey: string | null;
  dailyStreak: number;
  isWin: boolean;
}

/** Localized label strings the card needs (kept out of the renderer). */
export interface ShareCardLabels {
  title: string;         // "Dev/End"
  bankedOvertime: string;
  reachedLevel: string;  // "Level {n}" pre-formatted by the caller
  rankLine: string | null;
  dailyLine: string | null;
  outcome: string;       // "Shipped!" / "Laid off at level N" style, caller-built
}

/**
 * Pure layout: the ordered text lines under the score. Split out so tests can
 * cover content without a canvas 2D context (jsdom has none).
 */
export function buildShareLines(data: ShareCardData, labels: ShareCardLabels): string[] {
  const lines: string[] = [];
  lines.push(labels.outcome);
  lines.push(data.buildLine);
  if (data.capstoneName) lines.push(data.capstoneName);
  if (data.ascensionDepth > 0) lines.push(`↑ ${data.ascensionDepth}`);
  if (labels.rankLine) lines.push(labels.rankLine);
  if (labels.dailyLine) lines.push(labels.dailyLine);
  return lines;
}

const W = 1080;
const H = 1350; // 4:5, plays nice with most feeds

/**
 * Draw the card. Returns null when no 2D context exists (jsdom/tests).
 * Style mirrors the game's CRT look: near-black ground, phosphor-green
 * accent, gold for the record line.
 */
export function renderShareCard(
  data: ShareCardData,
  labels: ShareCardLabels,
  accent: string = '#00ff88',
): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Ground + subtle vignette.
  ctx.fillStyle = '#050807';
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H * 0.38, 80, W / 2, H * 0.38, W * 0.75);
  glow.addColorStop(0, `${accent}22`);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Faint scanlines for the CRT feel.
  ctx.fillStyle = 'rgba(255,255,255,0.02)';
  for (let y = 0; y < H; y += 6) ctx.fillRect(0, y, W, 2);

  // Frame.
  ctx.strokeStyle = `${accent}66`;
  ctx.lineWidth = 4;
  ctx.strokeRect(28, 28, W - 56, H - 56);

  ctx.textAlign = 'center';

  // Title.
  ctx.fillStyle = accent;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 24;
  ctx.font = 'bold 96px "Orbitron", "Segoe UI", sans-serif';
  ctx.fillText(labels.title, W / 2, 190);
  ctx.shadowBlur = 0;

  // The score is the hero.
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = accent;
  ctx.shadowBlur = 40;
  ctx.font = 'bold 220px "Orbitron", "Segoe UI", sans-serif';
  ctx.fillText(`${data.score}h`, W / 2, H * 0.42);
  ctx.shadowBlur = 0;
  ctx.fillStyle = `${accent}cc`;
  ctx.font = '600 44px "Segoe UI", sans-serif';
  ctx.fillText(labels.bankedOvertime.toUpperCase(), W / 2, H * 0.42 + 76);

  // Detail lines. Start a touch higher and pack tighter when every line is
  // present (depth + rank + daily), so the footer keeps its breathing room.
  const lines = buildShareLines(data, labels);
  let y = H * 0.56;
  const lineGap = lines.length >= 5 ? 76 : 84;
  for (const [i, line] of lines.entries()) {
    const isRank = labels.rankLine !== null && line === labels.rankLine;
    ctx.fillStyle = i === 0 ? '#ffffff' : isRank ? '#ffd54a' : 'rgba(255,255,255,0.75)';
    ctx.font = i === 0 ? 'bold 56px "Segoe UI", sans-serif' : '48px "Segoe UI", sans-serif';
    if (isRank) {
      ctx.shadowColor = '#ffd54a';
      ctx.shadowBlur = 18;
    }
    ctx.fillText(line, W / 2, y);
    ctx.shadowBlur = 0;
    y += lineGap;
  }

  // Footer: level + date.
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '36px "Segoe UI", sans-serif';
  ctx.fillText(labels.reachedLevel, W / 2, H - 120);
  ctx.fillText(new Date().toLocaleDateString(), W / 2, H - 70);

  return canvas;
}

/**
 * Share the card: Web Share API with a file when supported, else a download.
 * Returns 'shared' | 'downloaded' | 'unavailable' for the caller's feedback.
 */
export async function shareRunCard(
  data: ShareCardData,
  labels: ShareCardLabels,
  accent?: string,
): Promise<'shared' | 'downloaded' | 'unavailable'> {
  const canvas = renderShareCard(data, labels, accent);
  if (!canvas) return 'unavailable';
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return 'unavailable';

  const file = new File([blob], 'devend-run.png', { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: labels.title });
      return 'shared';
    } catch {
      // Cancelled or unsupported at the OS layer: fall through to download.
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'devend-run.png';
  a.click();
  URL.revokeObjectURL(url);
  return 'downloaded';
}
