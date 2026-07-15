/**
 * MusicDebugOverlay — opt-in music diagnostics (add ?musicdebug=1 to the URL).
 *
 * Renders a live readout of the crossfade deck's <audio> elements plus the
 * module flags, so we can see WHY music isn't sounding on a device we can't
 * attach a debugger to (autoplay rejection vs. load/decode error vs. muted vs.
 * volume 0). Safe in production: it only mounts when the query param is present.
 */
import { useEffect, useState } from 'react';
import { getMusicDiagnostics, debugForcePlayMain } from '@/lib/gameMusic';

const READY: Record<number, string> = { 0: 'NOTHING', 1: 'METADATA', 2: 'CURRENT', 3: 'FUTURE', 4: 'ENOUGH' };
const NET: Record<number, string> = { 0: 'EMPTY', 1: 'IDLE', 2: 'LOADING', 3: 'NO_SOURCE' };

export function MusicDebugOverlay() {
  const [snap, setSnap] = useState(() => getMusicDiagnostics());

  useEffect(() => {
    const id = setInterval(() => setSnap(getMusicDiagnostics()), 400);
    return () => clearInterval(id);
  }, []);

  const deck = snap.deck as Array<Record<string, unknown>> | null;
  const lastPlay = snap.lastPlay as { src: string; ok: boolean; err: string } | null;

  return (
    <div
      style={{
        position: 'fixed', left: 6, right: 6, bottom: 6, zIndex: 99999,
        background: 'rgba(0,0,0,0.88)', color: '#7CFC98', border: '1px solid #2dd4bf66',
        borderRadius: 8, padding: 8, font: '11px/1.35 monospace', maxHeight: '55vh', overflow: 'auto',
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
        <strong style={{ color: '#2dd4bf' }}>♪ music debug</strong>
        <button
          onClick={() => debugForcePlayMain()}
          style={{ background: '#2dd4bf', color: '#00110a', border: 0, borderRadius: 4, padding: '3px 10px', fontWeight: 700 }}
        >
          ▶ force play main
        </button>
      </div>

      <div>
        unlocked=<b>{String(snap.audioUnlocked)}</b> · key=<b>{String(snap.currentKey)}</b> ·
        vol=<b>{String(snap.musicVolume)}</b> · musicMuted=<b>{String(snap.musicMuted)}</b> ·
        globalMuted=<b>{String(snap.globalMuted)}</b>
      </div>

      {lastPlay && (
        <div style={{ color: lastPlay.ok ? '#7CFC98' : '#ff6b6b' }}>
          lastPlay: {lastPlay.src} {lastPlay.ok ? 'OK' : `REJECTED (${lastPlay.err})`}
        </div>
      )}

      {deck ? deck.map((d) => (
        <div key={String(d.i)} style={{ marginTop: 4, color: d.active ? '#fff' : '#7CFC98aa' }}>
          [{String(d.i)}{d.active ? '*' : ' '}] {String(d.src)}<br />
          &nbsp;paused=<b>{String(d.paused)}</b> muted=<b>{String(d.muted)}</b> vol=<b>{String(d.volume)}</b>
          &nbsp;t=<b>{String(d.currentTime)}</b>/{String(d.duration)}<br />
          &nbsp;ready=<b>{READY[d.readyState as number] ?? d.readyState}</b>
          &nbsp;net=<b>{NET[d.networkState as number] ?? d.networkState}</b>
          &nbsp;err=<b style={{ color: d.error ? '#ff6b6b' : undefined }}>{String(d.error)}</b>
          {d.priming ? ' (priming)' : ''}
        </div>
      )) : <div>deck: not created yet</div>}
    </div>
  );
}
