import { useState, type CSSProperties } from 'react';
import { parseModifierInput } from '@/lib/modifierInput';

/**
 * A number field that can be EMPTIED.
 *
 * It owns its text while it is being edited and only mirrors the number prop
 * when it is not, so clearing the field shows an empty field rather than the
 * old value snapping back (see parseModifierInput). An empty field counts as
 * 0, which is what the parent is told at once; on blur the text is dropped
 * and the field shows the number again.
 */
export function ModifierInput({
  value, step, min, onChange, className, style,
}: {
  value: number;
  step?: number;
  min?: number;
  onChange: (value: number) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      type="number"
      value={text ?? String(value)}
      step={step}
      min={min}
      onChange={e => {
        const raw = e.target.value;
        setText(raw);
        const next = parseModifierInput(raw);
        if (next !== null) onChange(next);
      }}
      onBlur={() => setText(null)}
      className={className}
      style={style}
    />
  );
}
