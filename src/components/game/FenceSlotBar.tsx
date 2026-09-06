/**
 * FenceSlotBar - the five slots beneath the board (FENCE_TYPES_PLAN.md).
 *
 * Which KIND of fence the next cut draws. A MODE, not a consumable: the
 * selected slot stays selected until it is changed, and there is no charge
 * count anywhere on it. That is the whole reason it is a separate bar from
 * AbilityBar rather than more buttons on the same one - an ability button says
 * "press me now", and this says "this is what you are drawing with".
 *
 *  - Tap a slot: select it. Every cut from then on is that type.
 *  - Long-press (450ms): open the explainer. The house gesture (CLAUDE.md).
 *  - The explainer also auto-opens ONCE the first time a type is acquired.
 *
 * ── Why it is always five ──────────────────────────────────────────────────
 *
 * Five is the floor and the usual number: a run can fill four slots at most, so
 * a player never sees more. The bar will draw more if it is handed more, which
 * is what the admin Playground does with the whole catalogue.
 *
 * Empty slots are DRAWN, not hidden. A bar that grew as types were acquired
 * would move the board every time the player bought one, and this sits directly
 * under a board whose bottom edge is where cuts get drawn. It also tells a new
 * player the system exists before they own any of it, which is the only thing
 * on screen that ever will: slot 1 alone would look like decoration.
 */
import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import {
  getFenceType, standardFenceType, FENCE_SLOTS, STANDARD_FENCE_ID,
  type FenceTypeDef,
} from '@/lib/fences';
import { hasSeenFenceType, markFenceTypeSeen } from '@/lib/fenceSeen';
import { FenceTypeInfoModal } from './FenceTypeInfoModal';

const LONG_PRESS_MS = 450;

interface FenceSlotBarProps {
  /**
   * The four swappable slots, standard excluded.
   *
   * Standard is not in here because it cannot be unequipped: keeping it in the
   * list would mean every caller had to remember not to remove it, and one that
   * forgot would take the ordinary fence away mid-run.
   */
  slotIds: string[];
  selectedId: string;
  accentColor: string;
  onSelect: (fenceTypeId: string) => void;
  /** Signals when the explainer opens/closes, so the shell can pause the game. */
  onInfoOpenChange?: (open: boolean) => void;
}

export function FenceSlotBar({
  slotIds, selectedId, accentColor, onSelect, onInfoOpenChange,
}: FenceSlotBarProps) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<FenceTypeDef | null>(null);

  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heldRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const clearPress = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  };
  useEffect(() => clearPress, []);

  // Slot 1 is standard and is never swappable; the rest are the player's, padded
  // out to FENCE_SLOTS with empties so the bar's height never changes.
  //
  // standard is filtered OUT of the roster rather than trusted to be absent.
  // The prop says it is excluded, and a caller that passed it anyway - a stale
  // save, a dev flag, a store card that forgot - would draw two Standard slots
  // and give the player a duplicate they cannot remove. Same argument as
  // withStandard in the catalogue: guarantee it, do not document it.
  const roster = slotIds.filter(id => id !== STANDARD_FENCE_ID);
  const owned = [standardFenceType(), ...roster.map(getFenceType)];
  // Five is a FLOOR, not a ceiling. A run can only ever fill four (see
  // ACQUIRABLE_SLOTS), so this changes nothing in a real game - but the admin
  // Playground hands the bar the whole catalogue, and truncating there would
  // hide a fence type from the one screen whose entire job is trying them all.
  // Hiding what you were handed is the worse failure of the two.
  const empties = Math.max(0, FENCE_SLOTS - owned.length);

  // First-acquire: show the explainer once per type the player owns and has not
  // been shown yet. Keyed on the owned set so a new grant fires it.
  const ownedKey = owned.map(f => f.id).join(',');
  useEffect(() => {
    const fresh = owned.find(f => f.id !== STANDARD_FENCE_ID && !hasSeenFenceType(f.id));
    if (fresh) { markFenceTypeSeen(fresh.id); setInfo(fresh); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownedKey]);

  useEffect(() => {
    onInfoOpenChange?.(!!info);
    return () => onInfoOpenChange?.(false);
  }, [info, onInfoOpenChange]);

  return (
    <>
      <div
        className="pointer-events-auto flex justify-center gap-1.5 px-3 py-1"
        style={{ backgroundColor: 'rgba(0,0,0,0.55)', fontFamily: "'JetBrains Mono', monospace" }}
      >
        {owned.map(f => {
          const color = f.color || accentColor;
          const selected = selectedId === f.id;
          return (
            <button
              key={f.id}
              aria-label={f.name}
              aria-pressed={selected}
              data-fence-slot={f.id}
              onPointerDown={(e) => {
                e.stopPropagation();
                heldRef.current = false;
                startRef.current = { x: e.clientX, y: e.clientY };
                clearPress();
                pressTimer.current = setTimeout(() => { heldRef.current = true; setInfo(f); }, LONG_PRESS_MS);
              }}
              onPointerUp={(e) => {
                e.stopPropagation();
                clearPress();
                if (!heldRef.current) onSelect(f.id);
              }}
              onPointerMove={(e) => {
                const s = startRef.current;
                if (s && (Math.abs(e.clientX - s.x) > 10 || Math.abs(e.clientY - s.y) > 10)) clearPress();
              }}
              onPointerLeave={clearPress}
              onPointerCancel={clearPress}
              onContextMenu={(e) => e.preventDefault()}
              className="relative flex items-center gap-1 rounded-md px-2.5 min-h-[44px] text-[11px] font-bold transition-transform active:scale-95"
              style={{
                color,
                border: `1px solid ${color}`,
                // The selected slot is filled and lit; the rest are outlines.
                // A ring alone was not enough at a glance on a dark board with
                // five buttons in a row.
                background: selected ? `${color}44` : `${color}14`,
                boxShadow: selected ? `0 0 12px ${color}` : 'none',
                opacity: selected ? 1 : 0.75,
                touchAction: 'none',
              }}
            >
              {/* The stripe IS the fence: the slot shows the colour that will
                  appear on the board, so the bar and the cut agree without the
                  player having to remember a name. */}
              <span
                className="inline-block rounded-sm"
                style={{ width: 3, height: 18, backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
              />
              <span>{f.name}</span>
              {/* The hold hint, per CLAUDE.md: an element that is holdable has
                  to look holdable. */}
              <Info className="w-3 h-3 opacity-50" />
            </button>
          );
        })}

        {Array.from({ length: empties }, (_, i) => (
          <div
            key={`empty-${i}`}
            aria-label={t('fenceTypes.emptySlot') as string}
            className="flex items-center justify-center rounded-md px-2.5 min-h-[44px] text-[11px]"
            style={{
              border: `1px dashed ${accentColor}33`,
              color: `${accentColor}55`,
              minWidth: 44,
            }}
          >
            +
          </div>
        ))}
      </div>
      {info && <FenceTypeInfoModal fence={info} onClose={() => setInfo(null)} />}
    </>
  );
}
