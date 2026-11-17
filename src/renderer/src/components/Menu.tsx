/** A button that opens a popover menu. Closes on outside click, Escape, a window resize, or item click. */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import type { IconName } from '../lib/icons';

/** True inside an open menu: a MenuButton in there unfolds in place instead of opening a second popover. */
const InsideMenu = createContext(false);

export function MenuButton({
  label,
  title,
  children,
  align = 'left',
  className = '',
  testId,
  wide,
}: {
  /** Moves into the overflow menu in compact view (read by OverflowRow). */
  low?: boolean;
  label: ReactNode;
  title?: string;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
  testId?: string;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const nested = useContext(InsideMenu);
  const ref = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // The popover is drawn at the top of the page (a portal) and placed from the
  // button's position, so nothing it sits in can clip it: toolbars are one
  // clipped row, and panels clip at their edges.
  const place = useCallback(() => {
    const a = ref.current;
    const m = menuRef.current;
    if (!a || !m || nested) return;
    const r = a.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = m.offsetWidth;
    const left = Math.max(6, Math.min(align === 'right' ? r.right - w : r.left, vw - w - 6));
    const below = vh - r.bottom - 11;
    const above = r.top - 11;
    m.style.left = `${Math.round(left)}px`;
    if (below < 170 && above > below) {
      // not enough room underneath: open upwards
      m.style.top = 'auto';
      m.style.bottom = `${Math.round(vh - r.top + 3)}px`;
      m.style.maxHeight = `${Math.round(above)}px`;
    } else {
      m.style.bottom = 'auto';
      m.style.top = `${Math.round(r.bottom + 3)}px`;
      m.style.maxHeight = `${Math.round(below)}px`;
    }
  }, [align, nested]);
  useLayoutEffect(() => {
    if (open) place();
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    // the button moves when the window or a panel resizes; a floating menu left behind would point at nothing
    const onResize = () => setOpen(false);
    const ro = new ResizeObserver(() => place());
    if (menuRef.current) ro.observe(menuRef.current);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, place]);

  const menu = open ? (
    <div ref={menuRef} className={`menu ${nested ? 'menu-inline' : 'menu-floating'} ${wide ? 'wide' : ''}`} role="menu">
      <InsideMenu.Provider value={true}>{children(() => setOpen(false))}</InsideMenu.Provider>
    </div>
  ) : null;

  return (
    <span className="menu-anchor" ref={ref}>
      <button
        type="button"
        className={`tool-btn menu-btn ${open ? 'open' : ''} ${className}`}
        title={title}
        data-testid={testId}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {menu && (nested ? menu : createPortal(menu, document.body))}
    </span>
  );
}

export function MenuItem({
  icon,
  label,
  description,
  hint,
  onClick,
  disabled,
  danger,
  checked,
  trailing,
  testId,
}: {
  icon?: IconName;
  label: ReactNode;
  description?: string;
  hint?: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  trailing?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      role="menuitem"
      data-testid={testId}
      className={`menu-item${disabled ? ' disabled' : ''}${danger ? ' danger' : ''}${checked ? ' checked' : ''}`}
      onClick={() => {
        if (!disabled) onClick?.();
      }}
    >
      <span className="menu-icon">{checked ? <Icon name="check" /> : icon ? <Icon name={icon} /> : null}</span>
      <span className="menu-text">
        <span className="menu-label">{label}</span>
        {description && <span className="menu-desc">{description}</span>}
      </span>
      {hint && <span className="menu-hint">{hint}</span>}
      {trailing && (
        <span className="menu-trailing" onClick={(e) => e.stopPropagation()}>
          {trailing}
        </span>
      )}
    </div>
  );
}

export function MenuSeparator() {
  return <div className="menu-sep" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="menu-heading">{children}</div>;
}
