/**
 * Toolbars that never wrap. A toolbar is one row: whatever does not fit moves
 * into an overflow menu (the three-dot button), and in compact view every
 * control marked `low` goes there too, so small panels keep only what is used
 * most. Compact view turns on by size, or always from Settings.
 */
import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Icon } from './Icon';
import { MenuButton } from './Menu';
import type { IconName } from '../lib/icons';
import { settingsStore } from '../state/settings';
import { useStore } from '../state/store';

/** Set for controls rendered inside an overflow menu: they show their text label there, and call this to close the menu once used. */
const InOverflow = createContext<(() => void) | null>(null);
/** Compact view for everything inside a panel; set by the panel frame from its width. */
export const CompactContext = createContext(false);
export const useCompact = (): boolean => useContext(CompactContext);

/** Compact when the element is narrower than `below` px, or when Settings forces compact view. */
export function useCompactWidth(ref: React.RefObject<HTMLElement | null>, below: number): boolean {
  const always = useStore(settingsStore, (s) => s.compact);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      if (w > 0) setNarrow(w < below);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, below]);
  return always || narrow;
}

interface ItemProps {
  low?: boolean;
}

function sameSet(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * One row of controls with an overflow menu. Children are the controls, in
 * priority order (the ones at the end leave first). `compact` overrides the
 * surrounding CompactContext.
 */
export function OverflowRow({
  children,
  className = '',
  compact,
  moreLabel,
  moreTitle = 'More controls',
  testId,
}: {
  children: ReactNode;
  className?: string;
  compact?: boolean;
  moreLabel?: (hidden: number) => ReactNode;
  moreTitle?: string;
  testId?: string;
}) {
  const ctxCompact = useCompact();
  const isCompact = compact ?? ctxCompact;
  const items = Children.toArray(children).filter(isValidElement) as ReactElement<ItemProps>[];
  const rowRef = useRef<HTMLDivElement>(null);
  const [wrapped, setWrapped] = useState<Set<number>>(() => new Set());

  const measure = useCallback(() => {
    const row = rowRef.current;
    if (!row || row.clientWidth === 0) return;
    const els = Array.from(row.children) as HTMLElement[];
    const next = new Set<number>();
    if (els.length) {
      const top = els[0].offsetTop;
      for (const el of els) if (el.offsetTop > top + 6) next.add(Number(el.dataset.i));
    }
    setWrapped((prev) => (sameSet(prev, next) ? prev : next));
  }, []);
  // After every render (labels change width), and whenever the row or one of its controls resizes.
  useLayoutEffect(measure);
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    for (const el of Array.from(row.children)) ro.observe(el);
    return () => ro.disconnect();
  });

  const isSpacer = (c: ReactElement) => c.type === ToolSpacer;
  const forced = (c: ReactElement<ItemProps>) => isCompact && !!c.props.low;
  const overflow = items.map((c, i) => ({ c, i })).filter(({ c, i }) => !isSpacer(c) && (forced(c) || wrapped.has(i)));

  return (
    <div className={`ov-row ${className}${isCompact ? ' compact' : ''}`}>
      <div className="ov-items" ref={rowRef}>
        {items.map((c, i) =>
          forced(c) ? null : (
            <span key={c.key ?? i} data-i={i} className={isSpacer(c) ? 'ov-spacer' : `ov-item${wrapped.has(i) ? ' ov-out' : ''}`}>
              {c}
            </span>
          ),
        )}
      </div>
      {overflow.length > 0 && (
        <MenuButton label={moreLabel ? moreLabel(overflow.length) : <Icon name="more" />} title={moreTitle} align="right" className="ov-more" testId={testId}>
          {(close) => (
            <InOverflow.Provider value={close}>
              <div className="ov-menu">
                {overflow.map(({ c, i }) => (
                  <div key={c.key ?? i} className="ov-menu-item">
                    {c}
                  </div>
                ))}
              </div>
            </InOverflow.Provider>
          )}
        </MenuButton>
      )}
    </div>
  );
}

export function Toolbar({ children, compact }: { children: ReactNode; compact?: boolean }) {
  return (
    <OverflowRow className="toolbar" compact={compact}>
      {children}
    </OverflowRow>
  );
}

/** Pushes the controls after it to the right edge. */
export function ToolSpacer(_props: ItemProps) {
  return null;
}

/**
 * A toolbar button. `icon` draws one of the app's icons; `text` is the label
 * used when the button sits in an overflow menu (icon-only buttons need one).
 * `low` marks a control that moves into the overflow menu in compact view.
 */
export function ToolButton({
  children,
  onClick,
  active,
  title,
  danger,
  icon,
  text,
  testId,
  disabled,
}: {
  /** Greyed out: there is nothing for it to do right now. */
  disabled?: boolean;
  children?: ReactNode;
  onClick?: () => void;
  active?: boolean;
  title?: string;
  danger?: boolean;
  icon?: IconName;
  text?: string;
  low?: boolean;
  testId?: string;
}) {
  const closeMenu = useContext(InOverflow);
  const inMenu = !!closeMenu;
  return (
    <button
      className={`tool-btn${active ? ' active' : ''}${danger ? ' danger' : ''}${icon && !children && !inMenu ? ' icon-only' : ''}`}
      onClick={() => {
        closeMenu?.();
        onClick?.();
      }}
      title={title}
      type="button"
      disabled={disabled}
      data-testid={testId}
      aria-label={text ?? title}
    >
      {icon && <Icon name={icon} />}
      {children}
      {inMenu && !children && text ? <span>{text}</span> : null}
    </button>
  );
}

export function ToolSelect({
  value,
  onChange,
  options,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  title?: string;
  low?: boolean;
}) {
  const closeMenu = useContext(InOverflow);
  return (
    <select
      className="tool-select"
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
        closeMenu?.();
      }}
      title={title}
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

export function ToolInput({
  value,
  onChange,
  placeholder,
  title,
  width,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  title?: string;
  width?: number;
  low?: boolean;
}) {
  return (
    <input
      className="tool-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      title={title}
      style={width ? { width } : undefined}
    />
  );
}

/** Any other content as one toolbar item (so it can carry `low`). */
export function ToolGroup({ children, className = '' }: { children: ReactNode; low?: boolean; className?: string }) {
  return <span className={`tool-group ${className}`}>{children}</span>;
}
