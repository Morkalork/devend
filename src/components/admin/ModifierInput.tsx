import { useRef, useState, type CSSProperties } from 'react';
import { parseModifierInput } from '@/lib/modifierInput';

/**
 * A number field that CLEARS when you enter it.
 *
 * Focusing it empties the box, so a new value is typed straight in rather
 * than edited around the old one; every parseable keystroke is reported at
 * once. Leaving it with nothing entered (or with half-typed text) puts the
 * value it had on entry back, on screen and in the parent if a keystroke had
 * already moved it, so a click-in-click-out changes nothing.
 *
 * It owns its text only while focused and mirrors the number prop otherwise,
 * so an outside reset shows through as soon as the field is not being edited.
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
  /** The value on entry, to fall back to if nothing new is entered. */
  const previous = useRef(value);
  return (
    <input
      type="number"
      value={text ?? String(value)}
      step={step}
      min={min}
      onFocus={() => {
        previous.current = value;
        setText('');
      }}
      onChange={e => {
        const raw = e.target.value;
        setText(raw);
        const next = parseModifierInput(raw);
        if (next !== null) onChange(next);
      }}
      onBlur={() => {
        if (text !== null && parseModifierInput(text) === null && value !== previous.current) {
          onChange(previous.current);
        }
        setText(null);
      }}
      className={className}
      style={style}
    />
  );
}
