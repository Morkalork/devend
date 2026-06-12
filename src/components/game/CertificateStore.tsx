/**
 * CertificateStore — the between-runs meta-progression shop.
 *
 * Certificates (public/certificates.yml) unlock by mastering upgrade chains
 * or completing achievements; their levels are bought here with Certificate
 * Hours. State and purchase logic live in useCertificateManager — this
 * component is purely presentational.
 */
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Medal, ArrowLeft, Check, Lock, ChevronRight, ChevronDown, Hexagon, Info } from 'lucide-react';
import { Certificate } from '@/types/certificate';
import { Achievement, ACHIEVEMENT_STAT_LABELS } from '@/types/achievement';
import { MetaProgressionStats } from '@/types/metaProgression';
import { UpgradeConfig } from '@/types/upgrade';
import { CRTBackground } from './CRTBackground';
import { Progress } from '@/components/ui/progress';
import { TutorialOverlay } from './TutorialOverlay';

interface CertificateStoreProps {
  certificates: Certificate[];
  totalCertificateHours: number;
  certLevelsOwned: Record<string, number>;
  unlockedCertIds: string[];
  maxTierCounts: Record<string, number>;
  onPurchaseCertLevel: (certId: string, targetLevel: number) => void;
  onBack: () => void;
  accentColor?: string;
  showTutorial?: boolean;
  onTutorialDismiss?: () => void;
  /** For locked-cert unlock tooltips: upgrade names, achievement requirements, lifetime stats. */
  upgrades?: UpgradeConfig[];
  achievements?: Achievement[];
  metaStats?: MetaProgressionStats;
  /** Lifetime Certificate Hours spent in this store (drives hours-spent unlocks). */
  lifetimeHoursSpent?: number;
}

/** What a locked certificate needs + how far along the player is. */
interface UnlockInfo {
  requirementText: string;
  current: number;
  required: number;
  progressLabel: string;
}

function getCostForSelection(
  cert: Certificate,
  targetLevel: number,
  certLevelsOwned: Record<string, number>,
): number {
  const currentOwned = certLevelsOwned[cert.id] || 0;
  return cert.levels.slice(currentOwned, targetLevel).reduce((sum, l) => sum + l.cost, 0);
}

export function CertificateStore({
  certificates,
  totalCertificateHours,
  certLevelsOwned,
  unlockedCertIds,
  maxTierCounts,
  onPurchaseCertLevel,
  onBack,
  accentColor,
  showTutorial = false,
  onTutorialDismiss,
  upgrades = [],
  achievements = [],
  metaStats,
  lifetimeHoursSpent = 0,
}: CertificateStoreProps) {
  // selectedLevel[certId] = target level (1-indexed) the player has tapped
  const [selectedLevels, setSelectedLevels] = useState<Record<string, number>>({});

  // ── Accordion state, shared by all sections ───────────────────────────────
  // Every certificate card collapses to a compact header and expands inline on
  // tap (locked: unlock requirement + progress; available: level buttons + buy
  // row; complete: description). Inline expansion (not a popup) so nothing can
  // clip against the scroll container — one card open at a time.
  const [expandedCertId, setExpandedCertId] = useState<string | null>(null);

  const toggleCard = (certId: string) => (e: React.MouseEvent<HTMLElement>) => {
    const card = e.currentTarget;
    const next = expandedCertId === certId ? null : certId;
    setExpandedCertId(next);
    // Bottom-of-list cards grow below the fold — reveal the expanded body
    // once the height animation has finished.
    if (next) {
      setTimeout(() => card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 230);
    }
  };

  /** Requirement text + live progress for a locked certificate. */
  const getUnlockInfo = (cert: Certificate): UnlockInfo => {
    if (cert.unlockType === 'upgrade-chain' && cert.sourceUpgradeId) {
      const upgrade = upgrades.find(u => u.id === cert.sourceUpgradeId);
      const upgradeName = upgrade ? `${upgrade.name} (${upgrade.tier})` : cert.sourceUpgradeId;
      const required = cert.requiredRuns ?? 3;
      return {
        requirementText: `Buy the ${upgradeName} upgrade in ${required} different runs.`,
        current: Math.min(maxTierCounts[cert.sourceUpgradeId] || 0, required),
        required,
        progressLabel: 'runs',
      };
    }
    if (cert.unlockType === 'achievement' && cert.sourceAchievementId) {
      const achievement = achievements.find(a => a.id === cert.sourceAchievementId);
      if (achievement) {
        const statValue = metaStats?.[achievement.requirement.stat] ?? 0;
        return {
          requirementText: `Complete the "${achievement.name}" achievement: ${achievement.description}`,
          current: Math.min(statValue, achievement.requirement.threshold),
          required: achievement.requirement.threshold,
          progressLabel: ACHIEVEMENT_STAT_LABELS[achievement.requirement.stat].toLowerCase(),
        };
      }
      return {
        requirementText: 'Complete the linked achievement.',
        current: 0,
        required: 1,
        progressLabel: '',
      };
    }
    if (cert.unlockType === 'hours-spent') {
      const required = cert.requiredHoursSpent ?? 1;
      return {
        requirementText: `Spend ${required} Certificate Hours in this store (on any certificates).`,
        current: Math.min(lifetimeHoursSpent, required),
        required,
        progressLabel: 'hours spent',
      };
    }
    return { requirementText: 'Keep playing to unlock.', current: 0, required: 1, progressLabel: '' };
  };

  const getCertStatus = (cert: Certificate) => {
    const levelsOwned = certLevelsOwned[cert.id] || 0;
    const isUnlocked = unlockedCertIds.includes(cert.id);
    const isMaxed = levelsOwned >= cert.levels.length;
    return { levelsOwned, isUnlocked, isMaxed };
  };

  const getSectionCerts = () => {
    const locked: Certificate[] = [];
    const available: Certificate[] = [];
    const maxed: Certificate[] = [];

    for (const cert of certificates) {
      const { isUnlocked, isMaxed } = getCertStatus(cert);
      if (!isUnlocked) {
        // Every certificate is visible; locked ones render disabled with an
        // unlock-requirement tooltip (hover / long-press).
        locked.push(cert);
      } else if (isMaxed) {
        maxed.push(cert);
      } else {
        available.push(cert);
      }
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

  // Live projected balance: starting from totalCertificateHours, deduct all pending selections
  const projectedBalance = useMemo(() => {
    let balance = totalCertificateHours;
    for (const cert of certificates) {
      const target = selectedLevels[cert.id];
      if (target != null) {
        balance -= getCostForSelection(cert, target, certLevelsOwned);
      }
    }
    return balance;
  }, [totalCertificateHours, selectedLevels, certificates, certLevelsOwned]);

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
                  const pendingCost = selectedTarget != null ? getCostForSelection(cert, selectedTarget, certLevelsOwned) : 0;
                  const canAfford = pendingCost <= totalCertificateHours && pendingCost > 0;
                  const expanded = expandedCertId === cert.id;

                  return (
                    <motion.div
                      key={cert.id}
                      initial={{ opacity: 0, x: -16 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.15 + i * 0.04 }}
                      className="p-4 rounded-lg border-2 border-white/30 bg-white/5 cursor-pointer"
                      style={{ boxShadow: selectedTarget != null ? '0 0 16px rgba(255,255,255,0.12)' : undefined }}
                      onClick={toggleCard(cert.id)}
                    >
                      {/* Header: name + description + owned summary + chevron */}
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-display font-bold text-base text-foreground">{cert.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{cert.description}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-display font-bold text-muted-foreground tabular-nums">
                            Lv {levelsOwned}/{cert.levels.length}
                          </span>
                          <ChevronDown
                            className={`w-5 h-5 text-muted-foreground transition-transform ${expanded ? 'rotate-180 text-white' : ''}`}
                          />
                        </div>
                      </div>

                      {/* Accordion body: level buttons + buy row */}
                      <AnimatePresence initial={false}>
                        {expanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2, ease: 'easeOut' }}
                            className="overflow-hidden"
                          >
                            {/* Purchases happen in here — don't let taps collapse the card */}
                            <div className="mt-3 pt-3 border-t border-white/10" onClick={(e) => e.stopPropagation()}>
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

                              {selectedTarget != null && (
                                <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/10">
                                  <div className="text-sm text-muted-foreground">
                                    Cost: <span className={canAfford ? 'text-white font-bold' : 'text-destructive font-bold'}>
                                      {pendingCost}h
                                    </span>
                                    {!canAfford && (
                                      <span className="text-xs text-destructive/80 ml-1">
                                        (need {pendingCost - totalCertificateHours}h more)
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
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}
              </Section>
            )}

            {/* ── Locked ── */}
            {locked.length > 0 && (
              <Section title="Locked">
                {locked.map((cert, i) => {
                  const unlock = getUnlockInfo(cert);
                  const expanded = expandedCertId === cert.id;

                  return (
                    <motion.div
                      key={cert.id}
                      initial={{ opacity: 0, x: -16 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.2 + i * 0.03 }}
                      className="p-4 rounded-lg border border-muted/30 bg-muted/5 grayscale cursor-pointer"
                      style={{ opacity: expanded ? 0.85 : 0.6 }}
                      onClick={toggleCard(cert.id)}
                    >
                      <div className="flex items-start gap-3">
                        <Lock className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="font-display font-bold text-sm text-muted-foreground">{cert.name}</p>
                          <p className="text-xs text-muted-foreground/70 mt-0.5">{cert.description}</p>
                          {unlock.required > 1 && (
                            <Progress
                              value={(unlock.current / unlock.required) * 100}
                              className="h-1 mt-2 bg-muted/30"
                            />
                          )}
                        </div>
                        {/* Keyboard path: Enter/Space clicks the button, which bubbles to the card */}
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={`How to unlock ${cert.name}`}
                          className={`shrink-0 -m-2 p-2 rounded-lg transition-colors ${expanded ? 'text-white' : 'text-muted-foreground'}`}
                        >
                          <Info className="w-5 h-5" />
                        </button>
                      </div>

                      {/* Accordion body: unlock requirement + progress, inline */}
                      <AnimatePresence initial={false}>
                        {expanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2, ease: 'easeOut' }}
                            className="overflow-hidden"
                          >
                            <div className="mt-3 pt-3 border-t border-white/10 space-y-1.5">
                              <p className="font-display font-bold text-xs uppercase tracking-wider text-white">
                                How to unlock
                              </p>
                              <p className="text-xs leading-relaxed text-foreground/85">{unlock.requirementText}</p>
                              <p className="text-xs font-bold tabular-nums text-white">
                                Progress: {unlock.current} / {unlock.required}
                                {unlock.progressLabel ? ` ${unlock.progressLabel}` : ''}
                              </p>
                              <Progress
                                value={(unlock.current / unlock.required) * 100}
                                className="h-1.5 bg-muted/40"
                              />
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}
              </Section>
            )}

            {/* ── Fully purchased ── */}
            {maxed.length > 0 && (
              <Section title="Complete">
                {maxed.map((cert, i) => {
                  const expanded = expandedCertId === cert.id;

                  return (
                    <motion.div
                      key={cert.id}
                      initial={{ opacity: 0, x: -16 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.25 + i * 0.03 }}
                      className="p-4 rounded-lg border border-white/20 bg-white/5 cursor-pointer"
                      style={{ opacity: expanded ? 0.85 : 0.6 }}
                      onClick={toggleCard(cert.id)}
                    >
                      <div className="flex items-center gap-3">
                        <Check className="w-5 h-5 text-white shrink-0" />
                        <p className="flex-1 min-w-0 font-display font-bold text-sm text-white">{cert.name}</p>
                        <span className="text-xs font-display font-bold text-muted-foreground tabular-nums shrink-0">
                          Lv {cert.levels.length}/{cert.levels.length}
                        </span>
                        <ChevronDown
                          className={`w-5 h-5 text-muted-foreground transition-transform shrink-0 ${expanded ? 'rotate-180 text-white' : ''}`}
                        />
                      </div>

                      <AnimatePresence initial={false}>
                        {expanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2, ease: 'easeOut' }}
                            className="overflow-hidden"
                          >
                            <div className="mt-3 pt-3 border-t border-white/10">
                              <p className="text-xs text-muted-foreground">{cert.description}</p>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}
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
