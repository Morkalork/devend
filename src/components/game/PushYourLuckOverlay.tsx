import { Trophy, Zap, Coins } from 'lucide-react';

interface PushYourLuckOverlayProps {
  remainingPercent: number;
  thresholdPercent: number;
  basePoints: number;
  onBank: () => void;
  onPush: () => void;
}

export function PushYourLuckOverlay({
  remainingPercent,
  thresholdPercent,
  basePoints,
  onBank,
  onPush,
}: PushYourLuckOverlayProps) {
  return (
    <>
      {/* Backdrop */}
      <div className="absolute inset-0 z-40 bg-background/50" />
      
      {/* Modal */}
      <div 
        className="push-luck-modal absolute z-50 overflow-y-auto"
        style={{
          bottom: '1rem',
          left: '1rem',
          right: '1rem',
        }}
      >
        <style>{`
          @media (min-width: 640px) {
            .push-luck-modal {
              top: 50% !important;
              bottom: auto !important;
              left: 50% !important;
              right: auto !important;
              width: 384px !important;
              margin-left: -192px !important;
              margin-top: -140px !important;
            }
          }
          @media (max-width: 639px) {
            .push-luck-modal {
              bottom: 5rem !important;
            }
          }
        `}</style>
        
        <div className="bg-card/95 border-2 border-success rounded-xl p-4 sm:p-6 shadow-2xl backdrop-blur-sm">
          {/* Header */}
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center">
              <Trophy className="w-5 h-5 text-success" />
            </div>
            <h2 className="text-xl font-display font-bold text-success">Level Cleared!</h2>
          </div>

          {/* Info */}
          <div className="text-center mb-4">
            <p className="text-muted-foreground text-sm mb-2">
              Remaining: <span className="text-foreground font-semibold">{remainingPercent}%</span>
              <span className="text-muted-foreground"> / {thresholdPercent}% target</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Cut more to earn an <span className="text-primary font-medium">Overcut Bonus</span>!
            </p>
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={onBank}
              className="flex-1 px-4 py-3 rounded-lg bg-success/20 text-success font-medium flex items-center justify-center gap-2 border border-success/50 hover:bg-success/30 hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              <Coins className="w-4 h-4" />
              Bank & Continue
            </button>
            <button
              onClick={onPush}
              className="flex-1 px-4 py-3 rounded-lg bg-primary text-primary-foreground font-bold flex items-center justify-center gap-2 shadow-lg hover:bg-primary/90 hover:scale-[1.02] active:scale-[0.98] transition-all"
              style={{ boxShadow: '0 0 20px hsl(var(--primary) / 0.4)' }}
            >
              <Zap className="w-4 h-4" />
              Push Your Luck
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
