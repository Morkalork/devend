/**
 * AbilityInfoModal — the explainer for a chest-earned ability (#38). Opened by
 * long-pressing an ability button, and auto-shown once the first time an ability
 * is acquired. Shows what it does and how to use it; dismiss on backdrop or X.
 */
import { X } from 'lucide-react';
import type { AbilityDef } from '@/lib/abilities';

interface AbilityInfoModalProps {
  ability: AbilityDef;
  onClose: () => void;
}

export function AbilityInfoModal({ ability, onClose }: AbilityInfoModalProps) {
  const color = ability.color || '#ffffff';
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
            {ability.name}
          </span>
          <button onClick={onClose} className="p-1 rounded" style={{ color }} title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-4 space-y-3 text-sm">
          {ability.description && (
            <p className="text-foreground leading-snug">{ability.description}</p>
          )}
          {ability.howTo && (
            <div>
              <div className="text-[10px] font-bold tracking-wider mb-1" style={{ color, opacity: 0.8 }}>
                HOW TO USE
              </div>
              <p className="text-muted-foreground leading-snug">{ability.howTo}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
