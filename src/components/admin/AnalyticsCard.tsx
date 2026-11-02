import { useEffect, useState } from 'react';
import { BarChart3, Trash2, Volume2, VolumeX } from 'lucide-react';
import {
  clearSessionEvents, getSessionEvents, isAnalyticsLive, isAnalyticsMuted, setAnalyticsMuted, subscribeSessionEvents,
  type SentEvent,
} from '@/lib/analytics';

/** One event's properties, short: "level=12 reason=timeUp". */
function propsText(e: SentEvent): string {
  return Object.entries(e.props)
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('+') : String(v)}`)
    .join(' ');
}

/**
 * The analytics events this launch raised, newest first, and whether each
 * went to PostHog (src/lib/analytics.ts). Opening Admin mutes analytics for
 * the rest of the launch, so a tester's runs do not count as players'; the
 * switch here lets them through, to check an event lands in PostHog.
 */
export function AnalyticsCard() {
  const [events, setEvents] = useState<readonly SentEvent[]>(() => [...getSessionEvents()]);
  const [muted, setMuted] = useState(isAnalyticsMuted);
  useEffect(() => subscribeSessionEvents(() => setEvents([...getSessionEvents()])), []);
  const live = isAnalyticsLive();
  const shown = [...events].reverse();

  const toggle = () => {
    setAnalyticsMuted(!muted);
    setMuted(!muted);
  };

  let status: string;
  if (!live) {
    status = 'No PostHog key in this build (or it has not loaded): events are only listed here.';
  } else if (muted) {
    status = 'Muted: Admin was opened, so this launch counts as testing. Events are listed, not sent.';
  } else {
    status = 'Sending to PostHog.';
  }

  return (
    <div className="w-full p-4 rounded-lg bg-card border border-border space-y-3">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-lg bg-primary/10">
          <BarChart3 className="w-6 h-6 text-muted-foreground" />
        </div>
        <div className="text-left flex-1">
          <div className="font-semibold">Analytics events this launch</div>
          <div className="text-sm text-muted-foreground">{status}</div>
        </div>
      </div>
      <div className="text-xs font-mono text-muted-foreground space-y-0.5 max-h-64 overflow-y-auto">
        {shown.length === 0 && <div>No events yet. Play a map, open a screen or change an option.</div>}
        {shown.map((e, i) => (
          <div key={`${e.at}-${i}`} className={e.sent ? 'text-emerald-300' : ''}>
            {new Date(e.at).toLocaleTimeString()} {e.sent ? 'sent' : 'not sent'} {e.event} {propsText(e)}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button id="admin-analytics-mute" onClick={toggle} disabled={!live}
          className="px-3 py-1.5 rounded border border-border text-xs hover:border-primary/50 flex items-center gap-1 disabled:opacity-50">
          {muted ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          {muted ? 'Send this launch\'s events' : 'Mute again'}
        </button>
        <button id="admin-analytics-clear" onClick={clearSessionEvents}
          className="px-3 py-1.5 rounded border border-border text-xs hover:border-primary/50 flex items-center gap-1">
          <Trash2 className="w-3.5 h-3.5" /> Clear list
        </button>
      </div>
    </div>
  );
}
