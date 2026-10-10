import { useState } from 'react';
import { ZoomIn, Copy, Check, Trash2, RefreshCw } from 'lucide-react';
import { clearZoomLog, getZoomLog, zoomLogText } from '@/lib/zoomRecorder';

/**
 * Stage 0 of CANVAS_UI_PLAN.md: the last zoom, resize and board re-layout
 * events on this device, newest first, with where the touch began.
 */
export function ZoomRecorderCard() {
  const [entries, setEntries] = useState(getZoomLog);
  const [copied, setCopied] = useState(false);
  const shown = [...entries].reverse().slice(0, 25);
  const incidents = entries.filter(e => e.kind === 'viewport' || e.kind === 'resize').length;

  const copy = async () => {
    const text = zoomLogText(entries, navigator.userAgent);
    try { await navigator.clipboard.writeText(text); } catch { window.prompt('Copy this', text); }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`w-full p-4 rounded-lg bg-card border space-y-3 ${incidents > 0 ? 'border-amber-400/60' : 'border-border'}`}>
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-lg bg-primary/10">
          <ZoomIn className="w-6 h-6 text-muted-foreground" />
        </div>
        <div className="text-left flex-1">
          <div className="font-semibold">Zoom and resize log</div>
          <div className="text-sm text-muted-foreground">
            Every browser zoom, window resize and board re-layout on this device, with the
            fingers down and what the touch began on. After the board zooms, come here and copy it.
          </div>
        </div>
      </div>
      <div className="text-xs font-mono text-muted-foreground space-y-0.5 max-h-64 overflow-y-auto">
        {shown.length === 0 && <div>Nothing recorded yet.</div>}
        {shown.map((e, i) => (
          <div key={i} className={e.kind === 'viewport' || e.kind === 'resize' ? 'text-amber-300' : ''}>
            {new Date(e.at).toLocaleTimeString()} {e.kind}: {e.detail} | fingers {e.fingers} | {e.startedOn}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button id="admin-zoom-refresh" onClick={() => setEntries(getZoomLog())}
          className="px-3 py-1.5 rounded border border-border text-xs hover:border-primary/50 flex items-center gap-1">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
        <button id="admin-zoom-copy" onClick={copy}
          className="px-3 py-1.5 rounded border border-border text-xs hover:border-primary/50 flex items-center gap-1">
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy log'}
        </button>
        <button id="admin-zoom-clear" onClick={() => { clearZoomLog(); setEntries([]); }}
          className="px-3 py-1.5 rounded border border-border text-xs hover:border-primary/50 flex items-center gap-1">
          <Trash2 className="w-3.5 h-3.5" /> Clear
        </button>
      </div>
    </div>
  );
}
