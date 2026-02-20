import { ArrowLeft, Map, Sparkles } from 'lucide-react';

interface AdminScreenProps {
  onBack: () => void;
  onMapBuilder: () => void;
  onAnimationTest: () => void;
}

export function AdminScreen({ onBack, onMapBuilder, onAnimationTest }: AdminScreenProps) {
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
              <div className="font-semibold">Animations</div>
              <div className="text-sm text-muted-foreground">
                Test ball assimilation and lock animations
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
