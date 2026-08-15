import { useState } from 'react';
import { ArrowLeft, Map, Sparkles, HeartPulse } from 'lucide-react';
import { DEV_LIVES, isInfiniteLivesEnabled, setInfiniteLivesEnabled } from '@/lib/devFlags';

interface AdminScreenProps {
  onBack: () => void;
  onMapBuilder: () => void;
  onAnimationTest: () => void;
}

export function AdminScreen({ onBack, onMapBuilder, onAnimationTest }: AdminScreenProps) {
  const [infiniteLives, setInfiniteLives] = useState(isInfiniteLivesEnabled);

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

        <p className="mt-6 text-xs text-muted-foreground">
          Tip: add <code className="text-primary">?level=22</code> to the URL and hit
          New Game to jump straight to a map.
        </p>
      </div>
    </div>
  );
}
