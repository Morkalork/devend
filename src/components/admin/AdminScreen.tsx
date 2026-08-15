import { useState } from 'react';
import { ArrowLeft, Map, Sparkles, HeartPulse, GitCommit, RefreshCw, Check, AlertCircle, Network } from 'lucide-react';
import { DEV_LIVES, isInfiniteLivesEnabled, setInfiniteLivesEnabled } from '@/lib/devFlags';
import {
  BUILD_AT, BUILD_REPO, BUILD_SHA, checkForUpdate, relativeTime, shortSha,
  type UpdateCheck,
} from '@/lib/buildInfo';

interface AdminScreenProps {
  onBack: () => void;
  onMapBuilder: () => void;
  onAnimationTest: () => void;
  onUpgradeAtlas: () => void;
}

export function AdminScreen({ onBack, onMapBuilder, onAnimationTest, onUpgradeAtlas }: AdminScreenProps) {
  const [infiniteLives, setInfiniteLives] = useState(isInfiniteLivesEnabled);
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
