/**
 * On-screen lock-decision log (admin only, `devend:lockDebug`).
 *
 * Deliberately not a console log: the locks worth investigating happen on a
 * phone against a deployed build, where there is no console to open. It is also
 * why this is plain absolutely-positioned text with no animation - it has to
 * survive being screenshotted and read back later.
 */
import { useEffect, useState } from 'react';
import { getLockDecisions, clearLockDecisions, type LockDecision } from '@/lib/lockDiagnostics';

const OUTCOME_COLOR: Record<LockDecision['outcome'], string> = {
  locked: '#6bffbc',
  'rejected-unsealed': '#ffd54a',
  'below-gate': '#8899aa',
};

const OUTCOME_LABEL: Record<LockDecision['outcome'], string> = {
  locked: 'LOCK',
  'rejected-unsealed': 'open',
  'below-gate': 'big',
};

export function LockDebugOverlay({ visible }: { visible: boolean }) {
  const [rows, setRows] = useState<LockDecision[]>([]);

  // Polled rather than pushed: the recorder is called from the physics step,
  // and having it trigger React renders would put this overlay in the hot path.
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setRows(getLockDecisions().slice(0, 6)), 400);
    return () => clearInterval(id);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="absolute left-1 right-1 bottom-1 z-50 rounded border pointer-events-auto"
      style={{
        // Near-opaque and monospace on purpose: this gets read back off a phone
        // screenshot taken over a busy board, not skimmed live.
        background: 'rgba(0,0,0,0.93)',
        borderColor: '#6bffbc55',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 10,
        lineHeight: 1.4,
        padding: '4px 5px',
      }}
    >
      <div className="flex items-center justify-between mb-0.5" style={{ color: '#6bffbc' }}>
        <span>LOCK DECISIONS (newest first)</span>
        <button
          onClick={() => { clearLockDecisions(); setRows([]); }}
          style={{ color: '#ffd54a', padding: '0 4px' }}
        >
          clear
        </button>
      </div>
      {rows.length === 0 && <div style={{ color: '#8899aa' }}>no candidates yet</div>}
      {rows.map((d, i) => (
        <div key={i} style={{ color: OUTCOME_COLOR[d.outcome] }}>
          {OUTCOME_LABEL[d.outcome].padEnd(5)}
          {' cells='}{d.regionCells}
          {' den='}{d.denominator}
          {' '}{d.percentage.toFixed(2)}{'%<='}{d.thresholdPercent}
          {' seal='}{d.trulySealed === null ? 'skip' : d.trulySealed ? 'yes' : 'NO'}
          {d.lockedBySliver && ' sliver'}
          {d.containedInArea && ' inArea'}
          {d.isBoss && ' boss'}
        </div>
      ))}
    </div>
  );
}
