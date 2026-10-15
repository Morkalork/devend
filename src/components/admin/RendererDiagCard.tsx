import { useState } from 'react';
import { Stethoscope, Copy, Check, Trash2, RotateCcw } from 'lucide-react';
import {
  clearQualitySteps, clearRendererDiag, diagText, getQualitySteps, getRendererDiag, probeWebGL, qualityStepText,
  type WebGLProbe,
} from '@/lib/rendering/rendererDiag';
import { getLearnedLimit, getQualitySetting, setLearnedLimit, type RendererChoice } from '@/lib/rendering/render3dSettings';

/**
 * "Did the 3D board start on this device, and if not, why?" (rendererDiag.ts).
 * The game falls back to 2D silently, so this is the one place that says so.
 */
export function RendererDiagCard({ choice }: { choice: RendererChoice }) {
  const [diag, setDiag] = useState(getRendererDiag);
  const [probe, setProbe] = useState<WebGLProbe | null>(null);
  const [copied, setCopied] = useState(false);
  // What auto quality has learned this device can hold, and the steps that taught it.
  const [learned, setLearned] = useState(getLearnedLimit);
  const [steps, setSteps] = useState(getQualitySteps);

  const failed = diag?.outcome === 'failed';
  const shaderTrouble = (diag?.shaderErrors?.length ?? 0) > 0;
  const bad = failed || shaderTrouble;
  const status = choice === 'sleek'
    ? 'Switched to the 2D board below, so the 3D board is not being tried.'
    : learned === '2d' && getQualitySetting() === 'auto'
      ? 'Auto quality found even the cheapest 3D tier too slow here, so boards use the 2D renderer. Reset learned quality to try 3D again.'
    : !diag
      ? 'No 3D start recorded on this device yet. Start a map, then come back.'
      : failed
        ? 'The 3D board failed to start, so the game fell back to the 2D board.'
        : shaderTrouble
          ? 'The 3D board started, but some of its shaders would not compile on this device.'
          : 'The 3D board started normally.';

  const copy = async () => {
    const text = diagText(choice, diag, probe ?? probeWebGL(), steps, learned);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt('Copy this', text);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`w-full p-4 rounded-lg bg-card border space-y-3 ${bad ? 'border-destructive' : 'border-border'}`}>
      <div className="flex items-center gap-4">
        <div className={`p-3 rounded-lg ${bad ? 'bg-destructive/20' : 'bg-primary/10'}`}>
          <Stethoscope className={`w-6 h-6 ${bad ? 'text-destructive' : 'text-muted-foreground'}`} />
        </div>
        <div className="text-left flex-1">
          <div className="font-semibold">3D on this device</div>
          <div className="text-sm text-muted-foreground">{status}</div>
        </div>
      </div>

      {diag && (
        <div className="text-xs text-muted-foreground space-y-1 break-words">
          <div>Last 3D start: {diag.outcome} at {new Date(diag.at).toLocaleString()}{diag.build ? ` (build ${diag.build.slice(0, 7)})` : ''}</div>
          {diag.message && <div className="text-destructive font-mono">{diag.message}</div>}
          {diag.stack && <pre className="font-mono whitespace-pre-wrap text-[10px] opacity-80">{diag.stack}</pre>}
          {diag.shaderErrors?.map((s, i) => (
            <div key={i} className="text-destructive font-mono text-[10px]">shader: {s}</div>
          ))}
        </div>
      )}

      <div className="text-xs text-muted-foreground space-y-1 break-words">
        <div>
          Auto quality has learned:{' '}
          <span className={learned ? 'text-primary font-semibold' : ''}>
            {learned === '2d' ? 'the 2D board (even the cheapest 3D tier ran slow)' : learned ? learned.toUpperCase() : 'nothing yet'}
          </span>
        </div>
        <div className="opacity-80">
          When frames run slow on Auto, the board steps down a tier at the next map and this
          device starts every later board there. Under ~30 fps it also drops the 3D resolution
          at once. Reset to let it start from the device guess again.
        </div>
        {steps.map((s, i) => (
          <div key={i} className="font-mono text-[10px]">step: {qualityStepText(s)}</div>
        ))}
      </div>

      {probe && (
        <div className="text-xs text-muted-foreground font-mono space-y-0.5 break-words">
          <div>WebGL2: {String(probe.webgl2)} (board attributes: {String(probe.boardAttributes)})</div>
          <div>GPU: {probe.gpu ?? 'unknown'}</div>
          <div>Texture units {probe.maxTextureUnits ?? '?'}, MSAA {probe.maxSamples ?? '?'}, float targets {String(probe.floatTargets)}, half float {String(probe.halfFloatTargets)}</div>
          <div className="opacity-70">{probe.userAgent}</div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          id="admin-renderer-probe"
          onClick={() => setProbe(probeWebGL())}
          className="px-3 py-1.5 rounded border border-border text-xs hover:border-primary/50"
        >
          Check this device
        </button>
        <button
          id="admin-renderer-copy"
          onClick={copy}
          className="px-3 py-1.5 rounded border border-border text-xs hover:border-primary/50 flex items-center gap-1"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy report'}
        </button>
        {(learned || steps.length > 0) && (
          <button
            id="admin-renderer-reset-learned"
            onClick={() => { setLearnedLimit(null); clearQualitySteps(); setLearned(null); setSteps([]); }}
            className="px-3 py-1.5 rounded border border-border text-xs hover:border-primary/50 flex items-center gap-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset learned quality
          </button>
        )}
        {diag && (
          <button
            id="admin-renderer-clear"
            onClick={() => { clearRendererDiag(); setDiag(null); }}
            className="px-3 py-1.5 rounded border border-border text-xs hover:border-primary/50 flex items-center gap-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
