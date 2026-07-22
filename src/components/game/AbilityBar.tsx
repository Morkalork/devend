/**
 * AbilityBar — the row of pressable ability buttons beneath the board (#38).
 *
 * Abilities are earned by smashing treasure chests; charges bank run-wide in the
 * session. This shows one button per ability the player has a charge of (the bar
 * is empty until the first chest is smashed), in catalogue order. Pressing fires
 * the effect and spends one charge. Rendered inside the fixed GameBottomBar
 * wrapper (topSlot), so it stops click propagation to avoid opening the panel.
 * Name + colour come from the ability catalogue (public/abilities.yml); the icon
 * is chosen by the ability's effect KIND.
 */
import { Snowflake, Gauge, Eraser, Sparkles, Magnet, Waves, Zap, ShieldCheck } from 'lucide-react';
import { getAllAbilities, AbilityKind } from '@/lib/abilities';

const ICON_BY_KIND: Record<AbilityKind, typeof Snowflake> = {
  freeze: Snowflake,
  slow: Gauge,
  clearFences: Eraser,
  magnet: Magnet,
  shockwave: Waves,
  fenceRush: Zap,
  fenceShield: ShieldCheck,
};

interface AbilityBarProps {
  /** Run-wide banked charges: { abilityId -> count }. */
  charges: Record<string, number>;
  accentColor: string;
  /** Fire the ability (spends one charge). */
  onUse: (abilityId: string) => void;
}

export function AbilityBar({ charges, accentColor, onUse }: AbilityBarProps) {
  const owned = getAllAbilities().filter(a => (charges[a.id] ?? 0) > 0);
  if (owned.length === 0) return null;

  return (
    <div
      className="pointer-events-auto flex flex-wrap justify-center gap-2 px-3 py-1.5"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', fontFamily: "'JetBrains Mono', monospace" }}
    >
      {owned.map(a => {
        const Icon = ICON_BY_KIND[a.kind] ?? Sparkles;
        const count = charges[a.id] ?? 0;
        const color = a.color || accentColor;
        return (
          <button
            key={a.id}
            onClick={(e) => { e.stopPropagation(); onUse(a.id); }}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold transition-transform active:scale-95"
            style={{
              color,
              border: `1px solid ${color}`,
              background: `${color}1f`,
              boxShadow: `0 0 8px ${color}44`,
            }}
          >
            <Icon className="w-4 h-4" />
            <span>{a.name}</span>
            <span className="opacity-75">x{count}</span>
          </button>
        );
      })}
    </div>
  );
}
