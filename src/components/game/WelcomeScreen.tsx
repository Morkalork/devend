import { motion } from 'framer-motion';
import { AlertCircle, Loader2 } from 'lucide-react';
import { CRTBackground } from './CRTBackground';

interface WelcomeScreenProps {
  onStartGame: () => void;
  onTutorial: () => void;
  onOptions: () => void;
  onHighscores: () => void;
  onAdmin?: () => void;
  isLoading?: boolean;
  error?: string | null;
  accentColor?: string;
}

export function WelcomeScreen({ onStartGame, onTutorial, onOptions, onHighscores, onAdmin, isLoading, error, accentColor }: WelcomeScreenProps) {
  return (
    <>
      <CRTBackground accentColor={accentColor} />
      <div className="min-h-screen flex flex-col items-center justify-center p-6 relative z-10" style={{ backgroundColor: 'hsl(var(--background) / 0.85)' }}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute w-64 h-64 rounded-full bg-primary/5 blur-3xl"
          animate={{
            x: [0, 100, 0],
            y: [0, -50, 0],
          }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          style={{ top: '20%', left: '10%' }}
        />
        <motion.div
          className="absolute w-96 h-96 rounded-full bg-accent/5 blur-3xl"
          animate={{
            x: [0, -80, 0],
            y: [0, 60, 0],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
          style={{ bottom: '10%', right: '5%' }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative z-10 flex flex-col items-center gap-12"
      >
        {/* Title */}
        <motion.div
          className="text-center"
          initial={{ scale: 0.9 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
        <h1 className="game-title animate-pulse-glow">
            Dev/End
          </h1>
          <motion.p
            className="mt-4 text-muted-foreground text-lg tracking-wide"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            Slice. Trap. Survive.
          </motion.p>
        </motion.div>

        {/* Animated spinning ball preview with multi-axis illusion */}
        <motion.div
          className="relative w-20 h-20"
          animate={{ y: [0, -8, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        >
          {/* Outer glow */}
          <div 
            className="absolute inset-[-8px] rounded-full"
            style={{
              background: 'radial-gradient(circle, hsl(var(--primary) / 0.4) 0%, hsl(var(--primary) / 0.15) 50%, transparent 70%)',
            }}
          />
          
          {/* Ball base with 3D gradient */}
          <div 
            className="absolute inset-0 rounded-full overflow-hidden"
            style={{
              background: 'radial-gradient(ellipse at 30% 30%, hsl(var(--primary) / 1.2) 0%, hsl(var(--primary)) 35%, hsl(var(--primary) / 0.7) 70%, hsl(var(--primary) / 0.5) 100%)',
              boxShadow: '0 0 30px hsl(var(--primary) / 0.5), inset -8px -8px 20px rgba(0,0,0,0.3)',
            }}
          >
            {/* Layer 1: Latitude bands - tilting rotation */}
            <motion.div
              className="absolute inset-0"
              animate={{ rotateX: [0, 20, 0, -20, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            >
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 80 80">
                <ellipse cx="40" cy="20" rx="30" ry="6" fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="1.5" />
                <ellipse cx="40" cy="35" rx="36" ry="8" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="1.5" />
                <ellipse cx="40" cy="50" rx="36" ry="8" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="1.5" />
                <ellipse cx="40" cy="65" rx="30" ry="6" fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="1.5" />
              </svg>
            </motion.div>
            
            {/* Layer 2: Meridian lines - primary spin */}
            <motion.div
              className="absolute inset-0"
              animate={{ rotate: 360 }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
            >
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 80 80">
                {/* Vertical meridians with perspective */}
                <ellipse cx="25" cy="40" rx="8" ry="35" fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth="1.5" />
                <ellipse cx="40" cy="40" rx="3" ry="38" fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="2" />
                <ellipse cx="55" cy="40" rx="8" ry="35" fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth="1.5" />
              </svg>
            </motion.div>
            
            {/* Layer 3: Equatorial band with markers - fast spin */}
            <motion.div
              className="absolute inset-0"
              animate={{ rotate: -360 }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
            >
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 80 80">
                {/* Thick equator */}
                <line x1="2" y1="40" x2="78" y2="40" stroke="rgba(0,0,0,0.45)" strokeWidth="2.5" strokeLinecap="round" />
                {/* Segment markers */}
                <circle cx="12" cy="40" r="3" fill="rgba(0,0,0,0.35)" />
                <circle cx="28" cy="38" r="2.5" fill="rgba(0,0,0,0.3)" />
                <circle cx="52" cy="38" r="2.5" fill="rgba(0,0,0,0.3)" />
                <circle cx="68" cy="40" r="3" fill="rgba(0,0,0,0.35)" />
              </svg>
            </motion.div>
            
            {/* Layer 4: Polar caps - subtle tilt */}
            <motion.div
              className="absolute inset-0"
              animate={{ rotateY: [0, 15, 0, -15, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            >
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 80 80">
                <ellipse cx="40" cy="12" rx="14" ry="5" fill="rgba(0,0,0,0.1)" />
                <ellipse cx="40" cy="68" rx="14" ry="5" fill="rgba(0,0,0,0.1)" />
              </svg>
            </motion.div>
          </div>
          
          {/* Fixed highlight/glare overlay */}
          <div 
            className="absolute rounded-full pointer-events-none"
            style={{
              width: '50%',
              height: '35%',
              top: '10%',
              left: '15%',
              background: 'radial-gradient(ellipse at 40% 40%, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.25) 40%, transparent 70%)',
            }}
          />
          {/* Sharp specular highlight */}
          <div 
            className="absolute rounded-full pointer-events-none"
            style={{
              width: '12%',
              height: '12%',
              top: '18%',
              left: '22%',
              background: 'rgba(255,255,255,0.7)',
            }}
          />
        </motion.div>

        {/* Error state */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive"
          >
            <AlertCircle className="w-5 h-5" />
            <span className="text-sm">{error}</span>
          </motion.div>
        )}

        {/* Buttons */}
        <motion.div
          className="flex flex-col gap-4 w-full max-w-xs"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <motion.button
            className="arcade-button-primary rounded-lg flex items-center justify-center gap-2"
            onClick={onStartGame}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Loading...
              </>
            ) : (
              'Start Game'
            )}
          </motion.button>
          <motion.button
            className="arcade-button-secondary rounded-lg"
            onClick={onTutorial}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            disabled={isLoading}
          >
            Tutorial
          </motion.button>
          <motion.button
            className="arcade-button-secondary rounded-lg"
            onClick={onOptions}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            disabled={isLoading}
          >
            Options
          </motion.button>
          <motion.button
            className="arcade-button-secondary rounded-lg"
            onClick={onHighscores}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            disabled={isLoading}
          >
            Highscores
          </motion.button>
          {onAdmin && (
            <motion.button
              className="arcade-button-secondary rounded-lg opacity-70"
              onClick={onAdmin}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              Admin
            </motion.button>
          )}
        </motion.div>
      </motion.div>
    </div>
    </>
  );
}
