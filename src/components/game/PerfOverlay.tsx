/**
 * On-screen frame-timing HUD (admin only).
 *
 * The stats have been recorded every frame all along - the game loop calls
 * recordFrame - but the only reader was drawPerfOverlay, which paints into a 2D
 * context. The renderer is WebGL, so on the real board the toggle showed
 * nothing; the numbers existed and were unreachable.
 *
 * DOM rather than canvas: it costs the renderer nothing, it survives being
 * screenshotted off a phone, and it cannot itself land inside the render timing
 * it is reporting.
 */
import { useEffect, useState } from 'react';
import { perfLines, perfColor } from '@/lib/rendering/perfStats';

export function PerfOverlay({ visible }: { visible: boolean }) {
  const [lines, setLines] = useState<string[]>([]);
  const [color, setColor] = useState('#00ff88');

  // Polled, and deliberately slower than the frame rate: the numbers are rolling
  // averages over ~1.5s, so sampling faster would only add React renders to the
  // thing being measured.
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => {
      setLines(perfLines());
      setColor(perfColor());
    }, 250);
    return () => clearInterval(id);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="absolute left-1 top-1 z-50 rounded border pointer-events-none"
      style={{
        background: 'rgba(0,0,0,0.72)',
        borderColor: color,
        color: 'rgba(230,235,245,0.92)',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 10,
        lineHeight: 1.45,
        padding: '4px 6px',
        whiteSpace: 'pre',
      }}
    >
      {lines.map((l, i) => (
        <div key={i} style={i === 0 ? { color, fontWeight: 700 } : undefined}>{l}</div>
      ))}
    </div>
  );
}
