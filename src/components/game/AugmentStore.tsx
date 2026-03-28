import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Medal, ArrowLeft, Check, Lock, ChevronRight, Hexagon } from 'lucide-react';
import { Certificate } from '@/types/certificate';
import { CRTBackground } from './CRTBackground';
import { Progress } from '@/components/ui/progress';
import { TutorialOverlay } from './TutorialOverlay';

interface AugmentStoreProps {
  certificates: Certificate[];
  totalAugmentPoints: number;
  certLevelsOwned: Record<string, number>;
  unlockedCertIds: string[];
  maxTierCounts: Record<string, number>;
  onPurchaseCertLevel: (certId: string, targetLevel: number) => void;
  onBack: () => void;
  accentColor?: string;
  showTutorial?: boolean;
  onTutorialDismiss?: () => void;
}

export function AugmentStore({
  certificates,
  totalAugmentPoints,
  certLevelsOwned,
  unlockedCertIds,
  maxTierCounts,
  onPurchaseCertLevel,
  onBack,
  accentColor,
  showTutorial = false,
  onTutorialDismiss,
}: AugmentStoreProps) {
  // selectedLevel[certId] = target level (1-indexed) the player has tapped
  const [selectedLevels, setSelectedLevels] = useState<Record<string, number>>({});

  const getCertStatus = (cert: Certificate) => {
    const levelsOwned = certLevelsOwned[cert.id] || 0;
    const isUnlocked = unlockedCertIds.includes(cert.id);
    const isMaxed = levelsOwned >= cert.levels.length;
    return { levelsOwned, isUnlocked, isMaxed };
  };

  const getRunProgress = (cert: Certificate) => {
    if (cert.unlockType !== 'upgrade-chain' || !cert.sourceUpgradeId) return null;
    const current = maxTierCounts[cert.sourceUpgradeId] || 0;
    const required = cert.requiredRuns ?? 3;
    return { current, required };
  };

  const getSectionCerts = () => {
    const locked: Certificate[] = [];
    const available: Certificate[] = [];
    const maxed: Certificate[] = [];

    for (const cert of certificates) {
      const { levelsOwned, isUnlocked, isMaxed } = getCertStatus(cert);
      if (!isUnlocked) {
        // Only show locked certs the player has made progress toward
        const runProgress = getRunProgress(cert);
        const isStarted =
          cert.unlockType === 'upgrade-chain'
            ? runProgress != null && runProgress.current > 0
            : false; // achievement certs are hidden until unlocked
        if (isStarted) locked.push(cert);
      } else if (isMaxed) {
        maxed.push(cert);
      } else {
        available.push(cert);
      }
      void levelsOwned;
    }
    return { locked, available, maxed };
  };

  const { locked, available, maxed } = getSectionCerts();

  const handleLevelTap = (certId: string, level: number) => {
    const currentOwned = certLevelsOwned[certId] || 0;
    if (level <= currentOwned) return;
    setSelectedLevels(prev => {
      // Toggle off if already selected
      if (prev[certId] === level) {
        const next = { ...prev };
        delete next[certId];
        return next;
      }
      return { ...prev, [certId]: level };
    });
  };

  const getCostForSelection = (cert: Certificate, targetLevel: number): number => {
    const currentOwned = certLevelsOwned[cert.id] || 0;
    return cert.levels
      .slice(currentOwned, targetLevel)
      .reduce((sum, l) => sum + l.cost, 0);
  };

  const handleBuy = (cert: Certificate) => {
    const target = selectedLevels[cert.id];
    if (!target) return;
    onPurchaseCertLevel(cert.id, target);
    setSelectedLevels(prev => {
      const next = { ...prev };
      delete next[cert.id];
      return next;
    });
  };

  // Live projected balance: starting from totalAugmentPoints, deduct all pending selections
  const projectedBalance = useMemo(() => {
    let balance = totalAugmentPoints;
    for (const cert of certificates) {
      const target = selectedLevels[cert.id];
      if (target != null) {
        balance -= getCostForSelection(cert, target);
      }
    }
    return balance;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalAugmentPoints, selectedLevels, certificates, certLevelsOwned]);

  return (
    <>
      <CRTBackground accentColor={accentColor} />
      <div className="min-h-screen flex flex-col items-center bg-background/90 p-4 sm:p-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative z-10 flex flex-col items-center gap-6 w-full max-w-2xl"
        >
          {/* Header */}
          <div className="flex items-center gap-3">
            <Medal className="w-8 h-8 text-white" />
            <h1 className="text-3xl sm:text-4xl font-display font-black tracking-wider text-foreground">
              CERTIFICATES
            </h1>
          </div>

          {/* Balance */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="bg-white/10 border border-white/30 rounded-xl px-6 py-3 text-center"
            style={{ boxShadow: '0 0 20px rgba(255,255,255,0.1)' }}
          >
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
              Certificate Hours
            </p>
            <div className="flex items-center justify-center gap-2">
              <Hexagon className="w-6 h-6 text-white fill-white/20" />
              <p className="text-4xl font-display font-bold text-white">
                {projectedBalance}
              </p>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Earn 1h every 5 levels completed
            </p>
          </motion.div>

          {/* Cert list */}
          <div className="w-full flex flex-col gap-6 max-h-[55vh] overflow-y-auto pr-1">

            {/* ── Unlocked & levels available ── */}
            {available.length > 0 && (
              <Section title="Available">
                {available.map((cert, i) => {
                  const levelsOwned = certLevelsOwned[cert.id] || 0;
                  const selectedTarget = selectedLevels[cert.id];
                  const pendingCost = selectedTarget != null ? getCostForSelection(cert, selectedTarget) : 0;
                  const canAfford = pendingCost <= totalAugmentPoints && pendingCost > 0;

                  return (
                    <motion.div
                      key={cert.id}
                      initial={{ opacity: 0, x: -16 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.15 + i * 0.04 }}
                      className="p-4 rounded-lg border-2 border-white/30 bg-white/5"
                      style={{ boxShadow: selectedTarget != null ? '0 0 16px rgba(255,255,255,0.12)' : undefined }}
                    >
                      {/* Cert name + description */}
                      <div className="mb-3">
                        <p className="font-display font-bold text-base text-foreground">{cert.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{cert.description}</p>
                      </div>

                      {/* Level buttons */}
                      <div className="flex flex-wrap gap-2 mb-3">
                        {cert.levels.map((level, idx) => {
                          const levelNum = idx + 1;
                          const owned = levelNum <= levelsOwned;
                          const selected = selectedTarget != null && levelNum <= selectedTarget && levelNum > levelsOwned;

                          return (
                            <button
                              key={levelNum}
                              disabled={owned}
                              onClick={() => handleLevelTap(cert.id, levelNum)}
                              className={`
                                flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-display font-bold transition-all
                                ${owned
                                  ? 'border-white/40 bg-white/10 text-white/50 cursor-default'
                                  : selected
                                    ? 'border-white bg-white/20 text-white cursor-pointer'
                                    : 'border-white/20 bg-transparent text-muted-foreground hover:border-white/50 hover:text-white cursor-pointer'
                                }
                              `}
                            >
                              {owned ? (
                                <Check className="w-3.5 h-3.5" />
                              ) : (
                                <Hexagon className="w-3.5 h-3.5 fill-current opacity-50" />
                              )}
                              Lv {levelNum}
                              {!owned && (
                                <span className="text-xs font-normal opacity-70">({level.cost}h)</span>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {/* Buy row */}
                      {selectedTarget != null && (
                        <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/10">
                          <div className="text-sm text-muted-foreground">
                            Cost: <span className={canAfford ? 'text-white font-bold' : 'text-destructive font-bold'}>
                              {pendingCost}h
                            </span>
                            {!canAfford && (
                              <span className="text-xs text-destructive/80 ml-1">
                                (need {pendingCost - totalAugmentPoints}h more)
                              </span>
                            )}
                          </div>
                          <button
                            onClick={() => handleBuy(cert)}
                            disabled={!canAfford}
                            className="arcade-button-primary rounded-lg px-4 py-1.5 text-sm flex items-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none"
                          >
                            Buy up to Lv {selectedTarget}
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </Section>
            )}

            {/* ── Locked ── */}
            {locked.length > 0 && (
              <Section title="Locked">
                {locked.map((cert, i) => {
                  const runProgress = getRunProgress(cert);

                  return (
                    <motion.div
                      key={cert.id}
                      initial={{ opacity: 0, x: -16 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.2 + i * 0.03 }}
                      className="p-4 rounded-lg border border-muted/30 bg-muted/5 opacity-70"
                    >
                      <div className="flex items-start gap-3">
                        <Lock className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="font-display font-bold text-sm text-muted-foreground">{cert.name}</p>
                          <p className="text-xs text-muted-foreground/70 mt-0.5">{cert.description}</p>

                          {runProgress && (
                            <div className="mt-2">
                              <div className="flex justify-between text-xs text-muted-foreground/80 mb-1">
                                <span>Purchase max-tier upgrade</span>
                                <span>{runProgress.current} / {runProgress.required} runs</span>
                              </div>
                              <Progress
                                value={(runProgress.current / runProgress.required) * 100}
                                className="h-1.5 bg-muted/30"
                              />
                            </div>
                          )}

                          {cert.unlockType === 'achievement' && (
                            <p className="mt-2 text-xs text-muted-foreground/60 italic">
                              Unlock by completing the linked achievement.
                            </p>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </Section>
            )}

            {/* ── Fully purchased ── */}
            {maxed.length > 0 && (
              <Section title="Complete">
                {maxed.map((cert, i) => (
                  <motion.div
                    key={cert.id}
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.25 + i * 0.03 }}
                    className="p-4 rounded-lg border border-white/20 bg-white/5 opacity-60"
                  >
                    <div className="flex items-center gap-3">
                      <Check className="w-5 h-5 text-white shrink-0" />
                      <div>
                        <p className="font-display font-bold text-sm text-white">{cert.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{cert.description}</p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </Section>
            )}

            {certificates.length === 0 && (
              <p className="text-center text-muted-foreground text-sm py-8">Loading certificates…</p>
            )}
          </div>

          {/* Back */}
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            onClick={onBack}
            className="arcade-button-secondary rounded-lg flex items-center justify-center gap-2 mt-[-0.75rem]"
          >
            <ArrowLeft className="w-5 h-5" />
            Continue
          </motion.button>
        </motion.div>
      </div>

      {showTutorial && (
        <TutorialOverlay
          visible
          title="CERTIFICATE WORKSHOP"
          body="Unlock permanent bonuses by mastering upgrade families across multiple runs. Each certificate has levels you can purchase with Certificate Hours earned during gameplay."
          arrowDirection="none"
          onDismiss={() => onTutorialDismiss?.()}
        />
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs font-display font-bold uppercase tracking-widest text-muted-foreground mb-2 px-1">
        {title}
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}
