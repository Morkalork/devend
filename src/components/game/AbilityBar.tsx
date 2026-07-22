/**
 * AbilityBar — the row of pressable ability buttons beneath the board (#38).
 *
 * Abilities are earned by smashing treasure chests; charges bank run-wide in the
 * session. This shows one button per ability the player has a charge of (the bar
 * is empty until the first chest is smashed). Pressing fires the effect and
 * spends one charge. Rendered inside the fixed GameBottomBar wrapper (as part of
 * its topSlot), so it stops click propagation to avoid opening the details panel.
 */
import { Snowflake, Gauge, Eraser } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ABILITY_IDS, AbilityId } from '@/lib/abilities';

const ICONS: Record<AbilityId, typeof Snowflake> = {
  freezeAll: Snowflake,
  slowAll: Gauge,
  clearFences: Eraser,
};

interface AbilityBarProps {
  /** Run-wide banked charges: { abilityId -> count }. */
  charges: Record<string, number>;
  accentColor: string;
  /** Fire the ability (spends one charge). */
  onUse: (abilityId: string) => void;
}

export function AbilityBar({ charges, accentColor, onUse }: AbilityBarProps) {
  const { t } = useTranslation();
  const owned = ABILITY_IDS.filter(id => (charges[id] ?? 0) > 0);
  if (owned.length === 0) return null;

  return (
    <div
      className="pointer-events-auto flex flex-wrap justify-center gap-2 px-3 py-1.5"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', fontFamily: "'JetBrains Mono', monospace" }}
    >
      {owned.map(id => {
        const Icon = ICONS[id];
        const count = charges[id] ?? 0;
        return (
          <button
            key={id}
            onClick={(e) => { e.stopPropagation(); onUse(id); }}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold transition-transform active:scale-95"
            style={{
              color: accentColor,
              border: `1px solid ${accentColor}`,
              background: `${accentColor}1f`,
              boxShadow: `0 0 8px ${accentColor}44`,
            }}
          >
            <Icon className="w-4 h-4" />
            <span>{t(`game.chestReward.${id}`)}</span>
            <span className="opacity-75">x{count}</span>
          </button>
        );
      })}
    </div>
  );
}
