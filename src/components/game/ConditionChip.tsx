/**
 * The situation an upgrade needs, and whether it holds right now.
 *
 * Not optional polish. A conditional upgrade whose condition is not on the card
 * is a trap: the player pays for a number that then does not appear, and
 * concludes the game is broken rather than that they misread it.
 *
 * Showing whether it is LIVE for the map they are about to play is what turns
 * it from a gamble into a decision, which is the entire point of making
 * upgrades conditional. "+45 per superior lock, not on this map" is information
 * you can act on; "+45 per superior lock" that then pays nothing is a bug
 * report.
 */
import { useTranslation } from 'react-i18next';
import { Zap, Clock } from 'lucide-react';
import { conditionText, type UpgradeCondition } from '@/lib/upgradeConditions';

interface Props {
  condition: UpgradeCondition;
  /** Does it hold for the map about to be played? */
  live: boolean;
  sizeClass?: string;
}

export function ConditionChip({ condition, live, sizeClass = 'text-[10px]' }: Props) {
  const { t } = useTranslation();
  const { key, params } = conditionText(condition);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium border ${sizeClass} ${
        live
          ? 'border-success/60 bg-success/15 text-success'
          : 'border-muted-foreground/40 bg-muted/40 text-muted-foreground'
      }`}
      title={live ? t('upgradeConditions.liveNow') : t('upgradeConditions.notNow')}
    >
      {live ? <Zap className="w-2.5 h-2.5 shrink-0" /> : <Clock className="w-2.5 h-2.5 shrink-0" />}
      {t(key, params)}
    </span>
  );
}
