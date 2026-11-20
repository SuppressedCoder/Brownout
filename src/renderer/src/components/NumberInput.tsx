/**
 * A number box that takes math: type "0.09448 * 360" and the result is used
 * (and shown) when you press Enter or leave the box (core/mathExpr.ts). Esc
 * puts the old value back. Text that is not a number is marked; leaving the
 * box then puts the old value back.
 *
 * Use it for every typed number (AGENTS.md, Adding things).
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { evalNumber } from '@core/mathExpr';

export const MATH_HINT = 'Math works here, e.g. 0.09448 * 360';

export function NumberInput({
  value,
  onCommit,
  min = -Infinity,
  max = Infinity,
  allowEmpty = false,
  format = (v: number) => String(v),
  className = 'tool-input num',
  style,
  title,
  placeholder,
  disabled,
  testId,
}: {
  value: number | null;
  /** The new value (clamped to min..max), or null when the box was emptied and allowEmpty is on. */
  onCommit: (v: number | null) => void;
  min?: number;
  max?: number;
  allowEmpty?: boolean;
  format?: (v: number) => string;
  className?: string;
  style?: CSSProperties;
  title?: string;
  placeholder?: string;
  disabled?: boolean;
  testId?: string;
}) {
  const shown = value === null ? '' : format(value);
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(shown);
    setBad(false);
  }, [shown]);

  /** Use what was typed. Returns false when it is not a number. */
  const commit = (): boolean => {
    const t = text.trim();
    if (t === shown.trim()) return true;
    if (t === '') {
      if (allowEmpty) onCommit(null);
      else setText(shown);
      return true;
    }
    const v = evalNumber(t);
    if (v === null) return false;
    const c = Math.max(min, Math.min(max, v));
    onCommit(c);
    setText(format(c));
    return true;
  };

  return (
    <input
      className={`${className}${bad ? ' bad' : ''}`}
      style={style}
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      title={title ? `${title}\n${MATH_HINT}` : MATH_HINT}
      data-testid={testId}
      spellCheck={false}
      onChange={(e) => {
        setText(e.target.value);
        setBad(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          if (commit()) (e.target as HTMLInputElement).blur();
          else setBad(true);
        } else if (e.key === 'Escape' && text !== shown) {
          // put the old value back; this Esc does not also close the dialog around the box
          e.stopPropagation();
          setText(shown);
          setBad(false);
        }
      }}
      onBlur={() => {
        if (!commit()) {
          setText(shown);
          setBad(false);
        }
      }}
    />
  );
}
