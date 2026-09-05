/**
 * FenceTypeInfoModal - the explainer for a fence type (FENCE_TYPES_PLAN.md).
 *
 * Opened by long-pressing a slot, and auto-shown once the first time a type is
 * acquired. Deliberately built like AbilityInfoModal rather than sharing it: the
 * two show different things (a fence type has a build speed and no charges) and
 * a single component taking a union of both would be answering to two callers
 * with a pile of optional props, which is how a modal ends up saying "x0" over a
 * thing that has no charges.
 */
import { X, Hand } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FenceTypeDef } from '@/lib/fences';

interface Props {
  fence: FenceTypeDef;
  onClose: () => void;
}

/**
 * The one line that says what a type COSTS.
 *
 * Every special fence is paid for in build speed, so the modal has to name it -
 * this is the whole balance of the feature and it is invisible on the board
 * until the moment a ball is racing your cut, which is far too late to learn it.
 */
function speedLine(t: ReturnType<typeof useTranslation>['t'], fence: FenceTypeDef): string | null {
  if (fence.buildSpeed === 1) return null;
  const pct = Math.round(Math.abs(1 - fence.buildSpeed) * 100);
  return fence.buildSpeed < 1
    ? (t('fenceTypes.buildsSlower', { percent: pct }) as string)
    : (t('fenceTypes.buildsFaster', { percent: pct }) as string);
}

export function FenceTypeInfoModal({ fence, onClose }: Props) {
  const { t } = useTranslation();
  const color = fence.color || '#ffffff';
  const speed = speedLine(t, fence);
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl overflow-hidden"
        style={{ backgroundColor: '#0b0f14', border: `1px solid ${color}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: `1px solid ${color}44` }}
        >
          <span
            className="font-display text-sm font-bold"
            style={{ color, textShadow: `0 0 10px ${color}66` }}
          >
            {fence.name}
          </span>
          <button onClick={onClose} className="p-1 rounded" style={{ color }} title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-4 space-y-3 text-sm">
          {fence.description && (
            <p className="text-foreground leading-snug">{fence.description}</p>
          )}
          {speed && (
            <div
              className="rounded-md px-2.5 py-2 text-xs leading-snug"
              style={{ backgroundColor: `${color}14`, border: `1px solid ${color}33`, color }}
            >
              {speed}
            </div>
          )}
          {fence.howTo && (
            <div>
              <div className="text-[10px] font-bold tracking-wider mb-1" style={{ color, opacity: 0.8 }}>
                {t('abilityInfo.howToUse')}
              </div>
              <p className="text-muted-foreground leading-snug">{fence.howTo}</p>
            </div>
          )}
          <div
            className="flex items-start gap-2 rounded-md px-2.5 py-2"
            style={{ backgroundColor: `${color}14`, border: `1px solid ${color}33` }}
          >
            <Hand className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color }} />
            <p className="text-muted-foreground text-xs leading-snug">
              {t('fenceTypes.staysSelected')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
