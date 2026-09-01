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
import { motion } from 'framer-motion';
import { getAllAbilities, getAbility, AbilityDef } from '@/lib/abilities';
import { hasSeenAbility, markAbilitySeen } from '@/lib/abilitySeen';
import { AbilityInfoModal } from './AbilityInfoModal';
import { AbilityIcon } from './AbilityIcon';

const LONG_PRESS_MS = 450;

interface AbilityBarProps {
  /** Run-wide banked charges: { abilityId -> count }. */
  charges: Record<string, number>;
  accentColor: string;
  /** Fire (or arm, for targeted abilities) the ability. */
  onUse: (abilityId: string) => void;
  /** The ability currently armed and awaiting a board tap (targeted; e.g. Magnet). */
  armedAbilityId?: string | null;
  /** Signals when the info modal opens/closes, so the shell can pause the game. */
  onInfoOpenChange?: (open: boolean) => void;
}

export function AbilityBar({ charges, accentColor, onUse, armedAbilityId, onInfoOpenChange }: AbilityBarProps) {
  const owned = getAllAbilities().filter(a => (charges[a.id] ?? 0) > 0);

  // Blink an ability's button when its charge count RISES (a fresh grant or a
  // count-up, e.g. a just-tapped chest gem): easy to spot even in a full bar
  // (#38 rework). Keyed by a per-id nonce that bumps each gain so the flash
  // replays. Initialised from the first charges so a level start never blinks.
  const [blink, setBlink] = useState<Record<string, number>>({});
  const prevChargesRef = useRef<Record<string, number>>(charges);
  useEffect(() => {
    const prev = prevChargesRef.current;
    const gained = getAllAbilities().map(a => a.id).filter(id => (charges[id] ?? 0) > (prev[id] ?? 0));
    prevChargesRef.current = charges;
    if (gained.length === 0) return;
    setBlink(b => { const n = { ...b }; for (const id of gained) n[id] = (n[id] ?? 0) + 1; return n; });
  }, [charges]);

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

  // Tell the shell whether the explainer is open, so it can pause the game while
  // a modal is up. Cleanup signals closed on unmount too.
  useEffect(() => {
    onInfoOpenChange?.(!!infoAbility);
    return () => onInfoOpenChange?.(false);
  }, [infoAbility, onInfoOpenChange]);

  if (owned.length === 0 && !infoAbility) return null;

  return (
    <>
      {owned.length > 0 && (
        <div
          className="pointer-events-auto flex flex-wrap justify-center gap-2 px-3 py-1"
          style={{ backgroundColor: 'rgba(0,0,0,0.55)', fontFamily: "'JetBrains Mono', monospace" }}
        >
          {owned.map(a => {
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
                className="relative flex items-center gap-1.5 rounded-md px-3 min-h-[44px] text-xs font-bold transition-transform active:scale-95"
                style={{
                  color,
                  border: `1px solid ${color}`,
                  background: armed ? `${color}44` : `${color}1f`,
                  boxShadow: armed ? `0 0 12px ${color}` : `0 0 8px ${color}44`,
                  touchAction: 'none',
                }}
              >
                {blink[a.id] ? (
                  <motion.span
                    key={`blink-${a.id}-${blink[a.id]}`}
                    className="pointer-events-none absolute -inset-px rounded-md"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 1, 0.3, 1, 0] }}
                    transition={{ duration: 0.85, times: [0, 0.15, 0.4, 0.65, 1] }}
                    style={{ boxShadow: `0 0 14px 3px ${color}, inset 0 0 10px ${color}` }}
                  />
                ) : null}
                <AbilityIcon kind={a.kind} className="w-4 h-4" />
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
