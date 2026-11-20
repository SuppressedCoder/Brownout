/**
 * A number box that takes math: type "0.09448 * 360" and the result is used
 * (and shown) when you press Enter or leave the box (core/mathExpr.ts). Esc
 * puts the old value back. Text that is not a number is marked; leaving the
 * box then puts the old value back.
 *
 * It remembers the math: while the value is still the one the math gave, the
 * box is marked (dotted underline, the math in its tooltip) and clicking into
 * it shows the math again to edit. Boxes with a `memory` name keep it across
 * runs (localStorage); others while they are on screen.
 *
 * Use it for every typed number (AGENTS.md, Adding things).
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { evalNumber } from '@core/mathExpr';

export const MATH_HINT = 'Math works here, e.g. 0.09448 * 360';

interface Memo {
  expr: string;
  value: number;
}
const MEMO_KEY = 'brownout.mathMemory.v1';
const MEMO_MAX = 300;
let memos: Record<string, Memo> | null = null;
function allMemos(): Record<string, Memo> {
  if (!memos) {
    try {
      const raw = JSON.parse(localStorage.getItem(MEMO_KEY) ?? '{}') as unknown;
      memos = raw && typeof raw === 'object' ? (raw as Record<string, Memo>) : {};
    } catch {
      memos = {};
    }
  }
  return memos;
}
function remember(key: string, m: Memo | null): void {
  const all = allMemos();
  delete all[key];
  if (m) all[key] = m;
  // oldest first: drop the oldest past the limit
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - MEMO_MAX))) delete all[k];
  try {
    localStorage.setItem(MEMO_KEY, JSON.stringify(all));
  } catch {
    /* storage full or unavailable: remembered for this run only */
  }
}
const PLAIN = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

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
  memory,
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
  /** A name for what this box sets (e.g. "<profile>:<part>:x"), so the math typed into it is remembered across runs. */
  memory?: string;
}) {
  const shown = value === null ? '' : format(value);
  const local = useRef<Memo | null>(null);
  /** The math that gave the value now in the box, if any. */
  const recalled = (): Memo | null => {
    const m = memory ? (allMemos()[memory] ?? null) : local.current;
    return m && value !== null && m.value === value ? m : null;
  };
  const math = recalled();
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
    // the remembered math, unchanged: nothing to do
    if (math && t === math.expr) {
      setText(shown);
      return true;
    }
    if (t === '') {
      if (allowEmpty) onCommit(null);
      else setText(shown);
      return true;
    }
    const v = evalNumber(t);
    if (v === null) return false;
    const c = Math.max(min, Math.min(max, v));
    const m = PLAIN.test(t) ? null : { expr: t, value: c };
    if (memory) remember(memory, m);
    else local.current = m;
    onCommit(c);
    setText(format(c));
    return true;
  };

  return (
    <input
      className={`${className}${bad ? ' bad' : ''}${math ? ' has-math' : ''}`}
      style={style}
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      title={[title, math ? `= ${math.expr} (click to edit the math)` : MATH_HINT].filter(Boolean).join('\n')}
      data-testid={testId}
      spellCheck={false}
      onFocus={(e) => {
        // show the math that gave this value, to edit it
        if (math && text === shown) {
          setText(math.expr);
          const el = e.target;
          requestAnimationFrame(() => el.select());
        }
      }}
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
