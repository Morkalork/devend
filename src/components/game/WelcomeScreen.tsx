import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Loader2, Clock, Zap, Sparkles, Hexagon, Trophy, ChevronRight } from 'lucide-react';
import { CRTBackground } from './CRTBackground';
import { MemoryParallaxLayer } from './MemoryParallaxLayer';
import { CheckpointPicker } from './CheckpointPicker';

interface WelcomeScreenProps {
  onStartGame: () => void;
  onStartFromLevel?: (level: number) => void;
  onTutorial: () => void;
  onOptions: () => void;
  onAugments?: () => void;
  onAchievements?: () => void;
  onAdmin?: () => void;
  isLoading?: boolean;
  error?: string | null;
  accentColor?: string;
  checkpointLevel?: number;
  checkpointRemainingMs?: number;
  totalAugmentPoints?: number;
  completedAchievementCount?: number;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function WelcomeScreen({
  onStartGame,
  onStartFromLevel,
  onTutorial,
  onOptions,
  onAugments,
  onAchievements,
  onAdmin,
  isLoading,
  error,
  accentColor,
  checkpointLevel,
  checkpointRemainingMs,
  totalAugmentPoints,
  completedAchievementCount,
}: WelcomeScreenProps) {
  const [remainingTime, setRemainingTime] = useState(checkpointRemainingMs || 0);
  const [showStartMapPicker, setShowStartMapPicker] = useState(false);
  
  // Update countdown timer
  useEffect(() => {
    if (!checkpointRemainingMs || checkpointRemainingMs <= 0) {
      setRemainingTime(0);
      return;
    }
    
    setRemainingTime(checkpointRemainingMs);
    
    const interval = setInterval(() => {
      setRemainingTime(prev => {
        const newTime = prev - 1000;
        return newTime > 0 ? newTime : 0;
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [checkpointRemainingMs]);
  
  const hasActiveCheckpoint = checkpointLevel && checkpointLevel > 1 && remainingTime > 0;
  return (
    <>
      <CRTBackground accentColor={accentColor} />
      <MemoryParallaxLayer accentColor={accentColor} />
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

        {/* Checkpoint Banner */}
        {hasActiveCheckpoint && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 }}
            className="w-full max-w-xs p-3 bg-primary/15 border border-primary/30 rounded-lg"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium text-foreground">
                  Start at Level {checkpointLevel}
                </span>
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                <span>{formatTime(remainingTime)}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Checkpoint expires in {formatTime(remainingTime)}
            </p>
          </motion.div>
        )}

        {/* Buttons */}
        <motion.div
          className="flex flex-col gap-4 w-full max-w-xs"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          {hasActiveCheckpoint ? (
            /* Split button: Continue (left) + level-picker arrow (right) */
            <div
              className="flex rounded-lg overflow-hidden border-2 border-primary bg-primary/10 animate-pulse-glow"
              style={{ boxShadow: '0 0 24px hsl(var(--primary) / 0.5), 0 0 48px hsl(var(--primary) / 0.2), inset 0 0 20px hsl(var(--primary) / 0.1)' }}
            >
              <motion.button
              className="flex-1 px-[1.45rem] py-[0.72rem] font-semibold text-[0.8rem] uppercase tracking-widest text-primary hover:bg-primary hover:text-primary-foreground transition-all duration-300 flex items-center justify-center gap-2"
                style={{ fontFamily: "'Orbitron', sans-serif" }}
                onClick={onStartGame}
                whileTap={{ scale: 0.98 }}
                disabled={isLoading}
              >
                {isLoading ? <><Loader2 className="w-5 h-5 animate-spin" /> Loading...</> : `Continue from Level ${checkpointLevel}`}
              </motion.button>
              <div className="w-px bg-primary/30 my-3" />
              <motion.button
                className="px-4 text-primary hover:bg-primary hover:text-primary-foreground transition-all duration-300 flex items-center"
                onClick={() => setShowStartMapPicker(true)}
                whileTap={{ scale: 0.95 }}
                disabled={isLoading}
                title="Choose start map"
              >
                <ChevronRight className="w-5 h-5" />
              </motion.button>
            </div>
          ) : (
            <motion.button
              className="arcade-button-primary arcade-button-sm animate-pulse-glow rounded-lg flex items-center justify-center gap-2"
              onClick={onStartGame}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              disabled={isLoading}
              style={{ boxShadow: '0 0 24px hsl(var(--primary) / 0.5), 0 0 48px hsl(var(--primary) / 0.2)' }}
            >
              {isLoading ? <><Loader2 className="w-5 h-5 animate-spin" /> Loading...</> : 'Start Game'}
            </motion.button>
          )}
          <motion.button
            className="arcade-button-primary arcade-button-sm rounded-lg"
            onClick={onTutorial}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            disabled={isLoading}
          >
            Tutorial
          </motion.button>
          <motion.button
            className="arcade-button-primary arcade-button-sm rounded-lg"
            onClick={onOptions}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            disabled={isLoading}
          >
            Options
          </motion.button>
          <motion.button
            className="arcade-button-primary arcade-button-sm rounded-lg flex items-center justify-center gap-2 disabled:opacity-20 disabled:grayscale disabled:cursor-not-allowed"
            onClick={onAugments}
            whileHover={onAugments ? { scale: 1.02 } : undefined}
            whileTap={onAugments ? { scale: 0.98 } : undefined}
            disabled={!onAugments || isLoading}
          >
            <Sparkles className="w-5 h-5" />
            Certificates
            {totalAugmentPoints !== undefined && totalAugmentPoints > 0 && (
              <span className="ml-1 text-xs bg-white/20 text-white px-2 py-0.5 rounded-full flex items-center gap-1">
                <Hexagon className="w-3 h-3" />
                {totalAugmentPoints}h
              </span>
            )}
          </motion.button>
          {onAchievements && (
            <motion.button
              className="arcade-button-primary arcade-button-sm rounded-lg flex items-center justify-center gap-2 disabled:opacity-20 disabled:grayscale disabled:cursor-not-allowed"
              onClick={onAchievements}
              whileHover={totalAugmentPoints ? { scale: 1.02 } : undefined}
              whileTap={totalAugmentPoints ? { scale: 0.98 } : undefined}
              disabled={!totalAugmentPoints || isLoading}
            >
              <Trophy className="w-5 h-5" />
              Achievements
              {completedAchievementCount !== undefined && completedAchievementCount > 0 && (
                <span className="ml-1 text-xs bg-white/20 text-white px-2 py-0.5 rounded-full">
                  {completedAchievementCount}
                </span>
              )}
            </motion.button>
          )}
          {onAdmin && (
            <motion.button
              className="arcade-button-secondary arcade-button-sm rounded-lg opacity-70"
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
    {showStartMapPicker && checkpointLevel && onStartFromLevel && (
      <CheckpointPicker
        maxLevel={checkpointLevel + 1}
        onSelect={(level) => { setShowStartMapPicker(false); onStartFromLevel(level); }}
        onClose={() => setShowStartMapPicker(false)}
        accentColor={accentColor}
      />
    )}
    </>
  );
}
