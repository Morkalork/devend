/**
 * AbilityBar — the row of pressable ability buttons beneath the board (#38).
 *
 * Abilities are earned by smashing treasure chests; charges bank run-wide in the
 * session. This shows one button per ability the player has a charge of (the bar
 * is empty until the first chest is smashed), in catalogue order.
 *
 *  - Tap a button: use the ability (targeted ones, e.g. Magnet, ARM instead and
 *    the player then taps the board; the armed button is ringed).
 *  - Long-press (450ms): open an info modal explaining the ability.
 *  - The info modal also auto-opens ONCE the first time each ability is acquired.
 *
 * Rendered inside the fixed GameBottomBar wrapper (topSlot); buttons stop click
 * propagation so they don't open the details panel.
 */
import { useState, useRef, useEffect } from 'react';
import { Snowflake, Gauge, Eraser, Sparkles, Magnet, Waves, Zap, ShieldCheck } from 'lucide-react';
import { getAllAbilities, getAbility, AbilityKind, AbilityDef } from '@/lib/abilities';
import { hasSeenAbility, markAbilitySeen } from '@/lib/abilitySeen';
import { AbilityInfoModal } from './AbilityInfoModal';

const ICON_BY_KIND: Record<AbilityKind, typeof Snowflake> = {
  freeze: Snowflake,
  slow: Gauge,
  clearFences: Eraser,
  magnet: Magnet,
  shockwave: Waves,
  fenceRush: Zap,
  fenceShield: ShieldCheck,
};

const LONG_PRESS_MS = 450;

interface AbilityBarProps {
  /** Run-wide banked charges: { abilityId -> count }. */
  charges: Record<string, number>;
  accentColor: string;
  /** Fire (or arm, for targeted abilities) the ability. */
  onUse: (abilityId: string) => void;
  /** The ability currently armed and awaiting a board tap (targeted; e.g. Magnet). */
  armedAbilityId?: string | null;
}

export function AbilityBar({ charges, accentColor, onUse, armedAbilityId }: AbilityBarProps) {
  const owned = getAllAbilities().filter(a => (charges[a.id] ?? 0) > 0);

  const [infoAbility, setInfoAbility] = useState<AbilityDef | null>(null);
  // Long-press state (single active press at a time).
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heldRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const clearPress = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; } };
  useEffect(() => clearPress, []);

  // First-acquire: auto-open the explainer once per ability the player owns and
  // hasn't been shown yet. Keyed on the owned-id set so it fires on a new grant.
  const ownedKey = owned.map(a => a.id).join(',');
  useEffect(() => {
    const fresh = owned.find(a => !hasSeenAbility(a.id));
    if (fresh) { markAbilitySeen(fresh.id); setInfoAbility(fresh); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownedKey]);

  if (owned.length === 0 && !infoAbility) return null;

  return (
    <>
      {owned.length > 0 && (
        <div
          className="pointer-events-auto flex flex-wrap justify-center gap-2 px-3 py-1.5"
          style={{ backgroundColor: 'rgba(0,0,0,0.55)', fontFamily: "'JetBrains Mono', monospace" }}
        >
          {owned.map(a => {
            const Icon = ICON_BY_KIND[a.kind] ?? Sparkles;
            const count = charges[a.id] ?? 0;
            const color = a.color || accentColor;
            const armed = armedAbilityId === a.id;
            return (
              <button
                key={a.id}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  heldRef.current = false;
                  startRef.current = { x: e.clientX, y: e.clientY };
                  clearPress();
                  pressTimer.current = setTimeout(() => { heldRef.current = true; setInfoAbility(getAbility(a.id) ?? a); }, LONG_PRESS_MS);
                }}
                onPointerUp={(e) => { e.stopPropagation(); clearPress(); if (!heldRef.current) onUse(a.id); }}
                onPointerMove={(e) => {
                  const s = startRef.current;
                  if (s && (Math.abs(e.clientX - s.x) > 10 || Math.abs(e.clientY - s.y) > 10)) clearPress();
                }}
                onPointerLeave={clearPress}
                onPointerCancel={clearPress}
                onContextMenu={(e) => e.preventDefault()}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold transition-transform active:scale-95"
                style={{
                  color,
                  border: `1px solid ${color}`,
                  background: armed ? `${color}44` : `${color}1f`,
                  boxShadow: armed ? `0 0 12px ${color}` : `0 0 8px ${color}44`,
                  touchAction: 'none',
                }}
              >
                <Icon className="w-4 h-4" />
                <span>{a.name}</span>
                <span className="opacity-75">x{count}</span>
              </button>
            );
          })}
        </div>
      )}
      {infoAbility && <AbilityInfoModal ability={infoAbility} onClose={() => setInfoAbility(null)} />}
    </>
  );
}
