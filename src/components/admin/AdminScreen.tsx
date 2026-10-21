import { useState } from 'react';
import { RendererDiagCard } from './RendererDiagCard';
import { UiKitPreview } from '@/ui/UiKitPreview';
import { ZoomRecorderCard } from './ZoomRecorderCard';
import { ArrowLeft, Map, Sparkles, HeartPulse, GitCommit, RefreshCw, Check, AlertCircle, Network, Layers, Users, Radar, Server, Moon, Box, Gauge, Eye, MoveVertical, ClipboardCheck, ClipboardList, Hand } from 'lucide-react';
import {
  DEV_LIVES, isInfiniteLivesEnabled, setInfiniteLivesEnabled,
  isForceRelayEnabled, setForceRelayEnabled,
  SIMULATED_NAPS, getSimulatedNap, setSimulatedNap, type SimulatedNap,
  getForcedSprintOffer, setForcedSprintOffer, getForcedJackpot, setForcedJackpot,
  isSprintAlwaysOn, setSprintAlwaysOn,
} from '@/lib/devFlags';
import { allOffers } from '@/lib/sprintOffers';
import { isTouchTraceEnabled, setTouchTraceEnabled } from '@/lib/touchTrace';
import { isUiOnDemandEnabled, setUiOnDemandEnabled } from '@/ui/onDemand';
import {
  BUILD_AT, BUILD_REPO, BUILD_SHA, checkForUpdate, relativeTime, shortSha,
  type UpdateCheck,
} from '@/lib/buildInfo';
import {
  getRendererChoice, setRendererChoice, getQualitySetting, setQualitySetting, QUALITY_SETTINGS,
  getFov, setFov, FOV_RANGE, DEFAULT_FOV, getHeightScale, setHeightScale, HEIGHT_RANGE,
  DEFAULT_HEIGHT_SCALE, getLean, setLean, LEAN_RANGE, DEFAULT_LEAN,
  getFrameCap, setFrameCap, FRAME_CAPS, DEFAULT_FRAME_CAP,
  type QualitySetting, type RendererChoice,
} from '@/lib/rendering/render3dSettings';
import { isFullDebrief, setFullDebrief } from '@/ui/screens/debriefMode';

interface AdminScreenProps {
  onBack: () => void;
  onMapBuilder: () => void;
  onAnimationTest: () => void;
  onUpgradeAtlas: () => void;
  onPairLoopback: () => void;
  onNearbyDiagnostics: () => void;
}

export function AdminScreen({ onBack, onMapBuilder, onAnimationTest, onUpgradeAtlas, onPairLoopback, onNearbyDiagnostics }: AdminScreenProps) {
  const [infiniteLives, setInfiniteLives] = useState(isInfiniteLivesEnabled);
  const [forceRelay, setForceRelay] = useState(isForceRelayEnabled);
  const [touchTrace, setTouchTrace] = useState(isTouchTraceEnabled);
  const [uiOnDemand, setUiOnDemand] = useState(isUiOnDemandEnabled);
  const [fullDebrief, setFullDebriefState] = useState(isFullDebrief);
  const [sprintOffer, setSprintOfferState] = useState<string | null>(getForcedSprintOffer);
  const [jackpot, setJackpotState] = useState(getForcedJackpot);
  const [sprintAlways, setSprintAlwaysState] = useState(isSprintAlwaysOn);
  const [nap, setNap] = useState<SimulatedNap>(getSimulatedNap);
  const [renderer, setRenderer] = useState<RendererChoice>(getRendererChoice);
  const [quality, setQuality] = useState<QualitySetting>(getQualitySetting);
  const [fov, setFovState] = useState(getFov);
  const [heightScale, setHeightState] = useState(getHeightScale);
  const [lean, setLeanState] = useState(getLean);
  const [frameCap, setFrameCapState] = useState(getFrameCap);
  const [kitOpen, setKitOpen] = useState(false);
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);

  const runUpdateCheck = async () => {
    setChecking(true);
    setUpdate(await checkForUpdate('dev'));
    setChecking(false);
  };

  const toggleInfiniteLives = () => {
    const next = !infiniteLives;
    setInfiniteLivesEnabled(next);
    setInfiniteLives(next);
  };

  if (kitOpen) return <UiKitPreview onClose={() => setKitOpen(false)} />;
  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={onBack}
            className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-bold text-primary">Admin Panel</h1>
          <span className="text-xs bg-destructive/20 text-destructive px-2 py-1 rounded">
            DEV ONLY
          </span>
        </div>

        {/* Admin Options */}
        <div className="space-y-4">
          <button
            onClick={onMapBuilder}
            className="w-full p-4 rounded-lg bg-card border border-border hover:border-primary/50 transition-colors flex items-center gap-4"
          >
            <div className="p-3 rounded-lg bg-primary/10">
              <Map className="w-6 h-6 text-primary" />
            </div>
            <div className="text-left">
              <div className="font-semibold">Map Builder</div>
              <div className="text-sm text-muted-foreground">
                Create and edit game levels
              </div>
            </div>
          </button>

          <button
            id="admin-canvas-kit"
            onClick={() => setKitOpen(true)}
            className="w-full p-4 rounded-lg bg-card border border-border hover:border-primary/50 transition-colors flex items-center gap-4"
          >
            <div className="p-3 rounded-lg bg-primary/10">
              <Layers className="w-6 h-6 text-primary" />
            </div>
            <div className="text-left">
              <div className="font-semibold">Canvas UI kit</div>
              <div className="text-sm text-muted-foreground">
                Every piece the canvas interface is built from, at phone size (CANVAS_UI_PLAN.md)
              </div>
            </div>
          </button>

          <button
            onClick={onAnimationTest}
            className="w-full p-4 rounded-lg bg-card border border-border hover:border-primary/50 transition-colors flex items-center gap-4"
          >
            <div className="p-3 rounded-lg bg-primary/10">
              <Sparkles className="w-6 h-6 text-primary" />
            </div>
            <div className="text-left">
              <div className="font-semibold">Playground</div>
              <div className="text-sm text-muted-foreground">
                Test animations and modifiers live
              </div>
            </div>
          </button>

          <button
            onClick={onUpgradeAtlas}
            className="w-full p-4 rounded-lg bg-card border border-border hover:border-primary/50 transition-colors flex items-center gap-4"
          >
            <div className="p-3 rounded-lg bg-primary/10">
              <Network className="w-6 h-6 text-primary" />
            </div>
            <div className="text-left">
              <div className="font-semibold">Upgrade Atlas</div>
              <div className="text-sm text-muted-foreground">
                The whole catalogue as a graph: what leads to what, how long each
                chain runs, and what looks wrong
              </div>
            </div>
          </button>

          <button
            onClick={onPairLoopback}
            className="w-full p-4 rounded-lg bg-card border border-border hover:border-primary/50 transition-colors flex items-center gap-4"
          >
            <div className="p-3 rounded-lg bg-primary/10">
              <Users className="w-6 h-6 text-primary" />
            </div>
            <div className="text-left">
              <div className="font-semibold">Pair Loopback</div>
              <div className="text-sm text-muted-foreground">
                Two-player, on one device: two simulations over a link whose
                latency, jitter and loss you set, with a button that breaks them
                apart on purpose
              </div>
            </div>
          </button>

          <button
            onClick={onNearbyDiagnostics}
            className="w-full p-4 rounded-lg bg-card border border-border hover:border-primary/50 transition-colors flex items-center gap-4"
          >
            <div className="p-3 rounded-lg bg-primary/10">
              <Radar className="w-6 h-6 text-primary" />
            </div>
            <div className="text-left">
              <div className="font-semibold">Nearby Diagnostics</div>
              <div className="text-sm text-muted-foreground">
                Which permission is missing, what the radios are doing, and every
                phone they can see. Two real devices only: Nearby does not run in
                an emulator
              </div>
            </div>
          </button>

          {/* Run flags: these change how a NORMAL run plays, so a late map can
              be reached without 20 clean clears. Persisted; a run that uses one
              never files on the highscore ledger. */}
          <button
            onClick={toggleInfiniteLives}
            aria-pressed={infiniteLives}
            className={`w-full p-4 rounded-lg bg-card border transition-colors flex items-center gap-4 ${
              infiniteLives ? 'border-primary' : 'border-border hover:border-primary/50'
            }`}
          >
            <div className={`p-3 rounded-lg ${infiniteLives ? 'bg-primary/25' : 'bg-primary/10'}`}>
              <HeartPulse className={`w-6 h-6 ${infiniteLives ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
            <div className="text-left flex-1">
              <div className="font-semibold">
                Infinite lives{' '}
                <span className={`text-xs ${infiniteLives ? 'text-primary' : 'text-muted-foreground'}`}>
                  {infiniteLives ? 'ON' : 'OFF'}
                </span>
              </div>
              <div className="text-sm text-muted-foreground">
                Start a normal run with {DEV_LIVES} lives. Takes effect on the next
                New Game, and keeps that run off the highscore ledger.
              </div>
            </div>
          </button>

          {/* The Debrief: the Acceptance Criteria ticket, marked (being tried),
              or the full breakdown it replaced. Display only, so not a run
              flag: a run with either stays on the ledger. */}
          <button
            onClick={() => { const next = !fullDebrief; setFullDebrief(next); setFullDebriefState(next); }}
            aria-pressed={fullDebrief}
            className={`w-full p-4 rounded-lg bg-card border transition-colors flex items-center gap-4 ${
              fullDebrief ? 'border-primary' : 'border-border hover:border-primary/50'
            }`}
          >
            <div className={`p-3 rounded-lg ${fullDebrief ? 'bg-primary/25' : 'bg-primary/10'}`}>
              <ClipboardCheck className={`w-6 h-6 ${fullDebrief ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
            <div className="text-left flex-1">
              <div className="font-semibold">
                Full debrief{' '}
                <span className={`text-xs ${fullDebrief ? 'text-primary' : 'text-muted-foreground'}`}>
                  {fullDebrief ? 'ON' : 'OFF'}
                </span>
              </div>
              <div className="text-sm text-muted-foreground">
                Off: after a map, won or failed, the Acceptance Criteria ticket with each line
                marked met or missed. On: the old Debrief (breakdown, axes, totals) and the old
                failed screen ("still needed" lines). Takes effect on the next map.
              </div>
            </div>
          </button>

          {/* Sprint Planning (SPRINT_PLANNING_PLAN.md). The draft is a feature
              unlock, each card is a draw from its pool, and the jackpot is one
              gamble in twenty at best: none of it can be looked at on purpose
              without these. In memory, and ledger-ineligible, like the other
              forced draws. */}
          <div className="w-full p-4 rounded-lg bg-card border border-border flex flex-col gap-3">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-primary/10">
                <ClipboardList className="w-6 h-6 text-muted-foreground" />
              </div>
              <div className="text-left flex-1">
                <div className="font-semibold">Sprint Planning</div>
                <div className="text-sm text-muted-foreground">
                  The run-start offer. Applies to the next run started from the menu (not the
                  debug level jump, which skips the draft).
                </div>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" id="sprint-always-on" checked={sprintAlways}
                onChange={e => { setSprintAlwaysOn(e.target.checked); setSprintAlwaysState(e.target.checked); }} />
              Show the draft before every run, even before it is unlocked
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" id="sprint-force-jackpot" checked={jackpot}
                onChange={e => { setForcedJackpot(e.target.checked); setJackpotState(e.target.checked); }} />
              Force the jackpot gamble
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Force an offer into its pool's slot (locked ones too)
              <select id="sprint-force-offer" className="bg-background border border-border rounded px-2 py-1"
                value={sprintOffer ?? ''}
                onChange={e => { const v = e.target.value || null; setForcedSprintOffer(v); setSprintOfferState(v); }}>
                <option value="">Random draw</option>
                {allOffers().map(o => (
                  <option key={o.id} value={o.id}>{o.pool}: {o.name}</option>
                ))}
              </select>
            </label>
          </div>

          {/* Pair Programming's network path. At home the direct link always
              wins, so the relay every public-Wi-Fi player uses would never be
              seen from a desk without this. Persisted; only the HOST's
              setting counts, since the host picks the link. */}
          <button
            onClick={() => { const next = !forceRelay; setForceRelayEnabled(next); setForceRelay(next); }}
            aria-pressed={forceRelay}
            className={`w-full p-4 rounded-lg bg-card border transition-colors flex items-center gap-4 ${
              forceRelay ? 'border-primary' : 'border-border hover:border-primary/50'
            }`}
          >
            <div className={`p-3 rounded-lg ${forceRelay ? 'bg-primary/25' : 'bg-primary/10'}`}>
              <Server className={`w-6 h-6 ${forceRelay ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
            <div className="text-left flex-1">
              <div className="font-semibold">
                Force 2-Player relay{' '}
                <span className={`text-xs ${forceRelay ? 'text-primary' : 'text-muted-foreground'}`}>
                  {forceRelay ? 'ON' : 'OFF'}
                </span>
              </div>
              <div className="text-sm text-muted-foreground">
                Pair through the server even when the phones could link directly, as on
                public Wi-Fi. Set it on the phone that shows the code.
              </div>
            </div>
          </button>

          {/* The interface canvas draws only when something on it changed
              (ui/onDemand.ts). Off draws every frame, as it used to: the way
              to tell "did not update" from "nothing changed" on a device. */}
          <button
            onClick={() => { const next = !uiOnDemand; setUiOnDemandEnabled(next); setUiOnDemand(next); }}
            aria-pressed={uiOnDemand}
            className={`w-full p-4 rounded-lg bg-card border transition-colors flex items-center gap-4 ${
              !uiOnDemand ? 'border-primary' : 'border-border hover:border-primary/50'
            }`}
          >
            <div className={`p-3 rounded-lg ${!uiOnDemand ? 'bg-primary/25' : 'bg-primary/10'}`}>
              <Layers className={`w-6 h-6 ${!uiOnDemand ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
            <div className="text-left flex-1">
              <div className="font-semibold">
                Interface draws on demand{' '}
                <span className={`text-xs ${!uiOnDemand ? 'text-primary' : 'text-muted-foreground'}`}>
                  {uiOnDemand ? 'ON' : 'OFF'}
                </span>
              </div>
              <div className="text-sm text-muted-foreground">
                The menus and HUD redraw only when something on them changes. Turn off to
                redraw every frame, if anything on screen ever fails to update. Reload to apply.
              </div>
            </div>
          </button>

          {/* What the board did with each touch, on the board itself. Built
              for "she drew a perfect fence and nothing happened": on someone
              else's phone there is no console, and this is the reason. */}
          <button
            onClick={() => { const next = !touchTrace; setTouchTraceEnabled(next); setTouchTrace(next); }}
            aria-pressed={touchTrace}
            className={`w-full p-4 rounded-lg bg-card border transition-colors flex items-center gap-4 ${
              touchTrace ? 'border-primary' : 'border-border hover:border-primary/50'
            }`}
          >
            <div className={`p-3 rounded-lg ${touchTrace ? 'bg-primary/25' : 'bg-primary/10'}`}>
              <Hand className={`w-6 h-6 ${touchTrace ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
            <div className="text-left flex-1">
              <div className="font-semibold">
                Touch trace{' '}
                <span className={`text-xs ${touchTrace ? 'text-primary' : 'text-muted-foreground'}`}>
                  {touchTrace ? 'ON' : 'OFF'}
                </span>
              </div>
              <div className="text-sm text-muted-foreground">
                Lists what the board did with the last few touches, bottom left of the board:
                started, refused and why, ignored as a grip, handed over, cancelled.
              </div>
            </div>
          </button>

          {/* The 2-Player screen's server readout. A real nap needs half an
              hour of nobody playing; this shows each state's copy on demand. */}
          <button
            onClick={() => {
              const next = SIMULATED_NAPS[(SIMULATED_NAPS.indexOf(nap) + 1) % SIMULATED_NAPS.length];
              setSimulatedNap(next);
              setNap(next);
            }}
            className={`w-full p-4 rounded-lg bg-card border transition-colors flex items-center gap-4 ${
              nap !== 'off' ? 'border-primary' : 'border-border hover:border-primary/50'
            }`}
          >
            <div className={`p-3 rounded-lg ${nap !== 'off' ? 'bg-primary/25' : 'bg-primary/10'}`}>
              <Moon className={`w-6 h-6 ${nap !== 'off' ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
            <div className="text-left flex-1">
              <div className="font-semibold">
                Server nap readout{' '}
                <span className={`text-xs ${nap !== 'off' ? 'text-primary' : 'text-muted-foreground'}`}>
                  {nap === 'off' ? 'REAL' : nap.toUpperCase()}
                </span>
              </div>
              <div className="text-sm text-muted-foreground">
                Tap to cycle what the 2-Player screen says about the server: the real
                check, asleep, just woke, or unreachable.
              </div>
            </div>
          </button>

        </div>

        {/* The board renderer (RENDER_3D_PLAN.md). Device settings, applied
            to the next board; the quality, field of view and height also take
            effect between maps. */}
        <div className="mt-6 space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Board renderer</h2>

          <RendererDiagCard choice={renderer} />
          <ZoomRecorderCard />

          <button
            onClick={() => {
              const next: RendererChoice = renderer === 'three' ? 'sleek' : 'three';
              setRendererChoice(next);
              setRenderer(next);
            }}
            aria-pressed={renderer === 'three'}
            className={`w-full p-4 rounded-lg bg-card border transition-colors flex items-center gap-4 ${
              renderer === 'three' ? 'border-primary' : 'border-border hover:border-primary/50'
            }`}
          >
            <div className={`p-3 rounded-lg ${renderer === 'three' ? 'bg-primary/25' : 'bg-primary/10'}`}>
              <Box className={`w-6 h-6 ${renderer === 'three' ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
            <div className="text-left flex-1">
              <div className="font-semibold">
                3D board{' '}
                <span className={`text-xs ${renderer === 'three' ? 'text-primary' : 'text-muted-foreground'}`}>
                  {renderer === 'three' ? '3D' : '2D'}
                </span>
              </div>
              <div className="text-sm text-muted-foreground">
                Real lights and shadows, standing walls and rolling balls. Off runs the
                2D board it is built on. Takes effect on the next board.
              </div>
            </div>
          </button>

          <button
            onClick={() => {
              const next = QUALITY_SETTINGS[(QUALITY_SETTINGS.indexOf(quality) + 1) % QUALITY_SETTINGS.length];
              setQualitySetting(next);
              setQuality(next);
            }}
            className={`w-full p-4 rounded-lg bg-card border transition-colors flex items-center gap-4 ${
              quality !== 'auto' ? 'border-primary' : 'border-border hover:border-primary/50'
            }`}
          >
            <div className={`p-3 rounded-lg ${quality !== 'auto' ? 'bg-primary/25' : 'bg-primary/10'}`}>
              <Gauge className={`w-6 h-6 ${quality !== 'auto' ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
            <div className="text-left flex-1">
              <div className="font-semibold">
                3D quality{' '}
                <span className={`text-xs ${quality !== 'auto' ? 'text-primary' : 'text-muted-foreground'}`}>
                  {quality.toUpperCase()}
                </span>
              </div>
              <div className="text-sm text-muted-foreground">
                Tap to cycle. Auto picks by device, steps down a tier when frames run
                slow and remembers it on this device (see 3D on this device below);
                the others pin a tier, for comparing. Minimal draws no shadows.
              </div>
            </div>
          </button>

          {/* Frames a second. 60 unless changed: a 120Hz phone drew everything
              twice as often for nothing, and ran hot doing it. */}
          <button
            onClick={() => {
              const next = FRAME_CAPS[(FRAME_CAPS.indexOf(frameCap) + 1) % FRAME_CAPS.length];
              setFrameCap(next);
              setFrameCapState(next);
            }}
            className={`w-full p-4 rounded-lg bg-card border transition-colors flex items-center gap-4 ${
              frameCap !== DEFAULT_FRAME_CAP ? 'border-primary' : 'border-border hover:border-primary/50'
            }`}
          >
            <div className={`p-3 rounded-lg ${frameCap !== DEFAULT_FRAME_CAP ? 'bg-primary/25' : 'bg-primary/10'}`}>
              <Gauge className={`w-6 h-6 ${frameCap !== DEFAULT_FRAME_CAP ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
            <div className="text-left flex-1">
              <div className="font-semibold">
                Frame cap{' '}
                <span className={`text-xs ${frameCap !== DEFAULT_FRAME_CAP ? 'text-primary' : 'text-muted-foreground'}`}>
                  {frameCap === 0 ? 'OFF' : `${frameCap} FPS`}
                </span>
              </div>
              <div className="text-sm text-muted-foreground">
                Tap to cycle 60, 30 and off. Caps how often the board draws on a fast
                display; 30 runs cooler, off draws every refresh. Takes effect on the next board.
              </div>
            </div>
          </button>

          <label className={`w-full p-4 rounded-lg bg-card border flex items-center gap-4 ${
            lean !== DEFAULT_LEAN ? 'border-primary' : 'border-border'
          }`}>
            <div className={`p-3 rounded-lg ${lean !== DEFAULT_LEAN ? 'bg-primary/25' : 'bg-primary/10'}`}>
              <Box className={`w-6 h-6 ${lean !== DEFAULT_LEAN ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
            <div className="text-left flex-1">
              <div className="font-semibold">View angle <span className="text-xs text-muted-foreground">{lean}</span></div>
              <div className="text-sm text-muted-foreground">
                The three-quarter view: how far walls, props and balls lean back so their fronts show.
                0 looks straight down. The floor and touch never move. Applies from the next map.
              </div>
            </div>
            <input
              id="admin-view-angle"
              type="number"
              inputMode="decimal"
              step={0.1}
              min={LEAN_RANGE[0]}
              max={LEAN_RANGE[1]}
              value={lean}
              onChange={(e) => {
                const raw = Number(e.target.value);
                const next = Math.max(LEAN_RANGE[0], Math.min(LEAN_RANGE[1], Number.isFinite(raw) ? raw : DEFAULT_LEAN));
                setLean(next);
                setLeanState(next);
              }}
              className="w-16 px-2 py-1 rounded bg-background border border-border text-center"
              aria-label="View angle"
            />
          </label>

          <label className={`w-full p-4 rounded-lg bg-card border flex items-center gap-4 ${
            fov !== DEFAULT_FOV ? 'border-primary' : 'border-border'
          }`}>
            <div className={`p-3 rounded-lg ${fov !== DEFAULT_FOV ? 'bg-primary/25' : 'bg-primary/10'}`}>
              <Eye className={`w-6 h-6 ${fov !== DEFAULT_FOV ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
            <div className="text-left flex-1">
              <div className="font-semibold">Field of view <span className="text-xs text-muted-foreground">{fov} deg</span></div>
              <div className="text-sm text-muted-foreground">
                Wider leans the walls further out from the middle of the board; narrower is flatter.
              </div>
            </div>
            <input
              type="number"
              inputMode="numeric"
              min={FOV_RANGE[0]}
              max={FOV_RANGE[1]}
              value={fov}
              onChange={(e) => {
                const next = Math.max(FOV_RANGE[0], Math.min(FOV_RANGE[1], Number(e.target.value) || DEFAULT_FOV));
                setFov(next);
                setFovState(next);
              }}
              className="w-16 px-2 py-1 rounded bg-background border border-border text-center"
              aria-label="Field of view in degrees"
            />
          </label>

          <label className={`w-full p-4 rounded-lg bg-card border flex items-center gap-4 ${
            heightScale !== DEFAULT_HEIGHT_SCALE ? 'border-primary' : 'border-border'
          }`}>
            <div className={`p-3 rounded-lg ${heightScale !== DEFAULT_HEIGHT_SCALE ? 'bg-primary/25' : 'bg-primary/10'}`}>
              <MoveVertical className={`w-6 h-6 ${heightScale !== DEFAULT_HEIGHT_SCALE ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
            <div className="text-left flex-1">
              <div className="font-semibold">Wall height <span className="text-xs text-muted-foreground">x{heightScale}</span></div>
              <div className="text-sm text-muted-foreground">
                How tall fences, the frame and obstacles stand, and so how long their shadows are.
              </div>
            </div>
            <input
              type="number"
              inputMode="decimal"
              step={0.1}
              min={HEIGHT_RANGE[0]}
              max={HEIGHT_RANGE[1]}
              value={heightScale}
              onChange={(e) => {
                const next = Math.max(HEIGHT_RANGE[0], Math.min(HEIGHT_RANGE[1], Number(e.target.value) || DEFAULT_HEIGHT_SCALE));
                setHeightScale(next);
                setHeightState(next);
              }}
              className="w-16 px-2 py-1 rounded bg-background border border-border text-center"
              aria-label="Wall height multiplier"
            />
          </label>
        </div>

        {/* Which build is this? On staging the URL never changes, so without
            this there is nothing on screen telling a fresh deploy from a stale
            one, and "my fix didn't work" looks the same as "it never shipped". */}
        <div className="mt-6 p-3 rounded-lg bg-card border border-border">
          <div className="flex items-center gap-2 text-sm">
            <GitCommit className="w-4 h-4 text-muted-foreground" />
            <span className="font-mono font-semibold">{shortSha(BUILD_SHA)}</span>
            <span className="text-muted-foreground text-xs">
              built {relativeTime(BUILD_AT)}
            </span>
            <button
              onClick={runUpdateCheck}
              disabled={checking}
              className="ml-auto flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-muted hover:bg-muted/70 disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${checking ? 'animate-spin' : ''}`} />
              {checking ? 'Checking' : 'Check dev'}
            </button>
          </div>

          {update && (
            <div className="mt-2 flex items-start gap-1.5 text-xs">
              {update.status === 'current' && (
                <><Check className="w-3.5 h-3.5 text-success flex-shrink-0 mt-0.5" />
                  <span className="text-success">Running the latest commit on dev.</span></>
              )}
              {update.status === 'behind' && (
                <><AlertCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0 mt-0.5" />
                  <span className="text-destructive">
                    {update.behindBy
                      ? `${update.behindBy} commit${update.behindBy === 1 ? '' : 's'} behind dev`
                      : 'Behind dev'}
                    {update.latestSha && ` (latest ${shortSha(update.latestSha)})`}. Not deployed yet.
                  </span></>
              )}
              {update.status === 'unknown' && (
                <><AlertCircle className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">Could not check: {update.problem}.</span></>
              )}
            </div>
          )}

          {!BUILD_SHA && (
            <p className="mt-2 text-xs text-muted-foreground">
              No commit stamp: this is a dev-server session, not a built bundle.
            </p>
          )}
          {BUILD_REPO && (
            <p className="mt-1 text-[10px] text-muted-foreground font-mono">{BUILD_REPO}</p>
          )}
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Tip: add <code className="text-primary">?level=22</code> to the URL and hit
          New Game to jump straight to a map.
        </p>
      </div>
    </div>
  );
}
