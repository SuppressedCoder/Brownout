/**
 * Field slots: the one box wherever a field is chosen, and the chip list
 * where several are.
 *
 * - FieldSlot: one field. Drag a field from the field list onto it, or click
 *   it and type: the rest of a matching name shows faintly and Tab takes it,
 *   and a list under the box shows the fields that fit, grouped by folder
 *   (arrows and Enter pick, Esc closes). While a field is dragged anywhere,
 *   every box that can take it lights up; the box under the pointer shows
 *   the field it would hold. A box that can't take it turns red and says
 *   why; letting go there, or Tab onto such a field, makes it shake.
 * - FieldList: several fields as chips with a "+ Field" chip at the end.
 *   Dropping on a chip swaps that field (it keeps its place and style);
 *   dropping on a chip's edge adds the field beside it; dropping on + Field
 *   adds it at the end.
 *
 * A field that isn't in the open logs gets a yellow outline; the reason is
 * in the tooltip. Nothing here moves time or re-renders on pointer moves:
 * the drag highlight changes only when a drag starts or ends (dragStore).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { sessionStore, type LogEntry } from '../state/session';
import { dragStore, readFieldDrag, hasFieldDrag, type FieldDrag } from '../lib/dnd';
import {
  useFieldIndex,
  keyMatchesSearch,
  groupByFolder,
  groupFields,
  completeKey,
  specAccepts,
  specLabel,
  specReason,
  splitKey,
  typeLabel,
  type FieldLike,
  type FieldSpec,
  type MergedField,
} from '../lib/fields';
import { Icon } from './Icon';
import { FolderGroups } from './FolderGroups';
import { linkStore, pointAtField } from '../lib/panelLinks';

const LIST_MAX = 300;

/** The logs a key is missing from (none when no logs are given). */
function missingFrom(key: string | undefined, logs: LogEntry[]): LogEntry[] {
  if (!key || !logs.length) return [];
  return logs.filter((l) => !l.fields.some((f) => f.key === key));
}

/** "Not in CURIE Q89" / "Not in the open logs". */
function missingText(miss: LogEntry[], logs: LogEntry[]): string {
  if (!miss.length) return '';
  if (miss.length === logs.length && logs.length > 2) return 'Not in the open logs';
  return `Not in ${miss.map((l) => l.name).join(', ')}`;
}

/** A key as the boxes show it: the folder dimmed, the name bold. */
export function KeyText({ k }: { k: string }) {
  const { folder, leaf } = splitKey(k);
  return (
    <span className="fkey">
      {folder && (
        <span className="key-folder">
          <bdi>{folder}</bdi>
        </span>
      )}
      <span className="fkey-leaf">{leaf}</span>
    </span>
  );
}

/** Shake an element once (a field it can't take was dropped or tabbed onto it). */
function useShake(): [boolean, () => void, () => void] {
  const [on, setOn] = useState(false);
  return [
    on,
    () => {
      setOn(false);
      requestAnimationFrame(() => setOn(true));
    },
    () => setOn(false),
  ];
}

/** Which way the current drag fits a box: null (no drag), 'ok' or 'bad'. */
function useDragFit(spec: FieldSpec | undefined): 'ok' | 'bad' | null {
  const items = useStore(dragStore, (s) => s.items);
  if (!items) return null;
  return specAccepts(spec, items[0]) ? 'ok' : 'bad';
}

// ---------------------------------------------------------------------------
// One field

export function FieldSlot({
  label,
  spec,
  value,
  onPick,
  onClear,
  logs: logsProp,
  testId,
  inline,
  panel,
  placeholder = 'none',
  className = '',
}: {
  /** What the box is for, on the label line. */
  label?: ReactNode;
  spec?: FieldSpec;
  value: string | undefined;
  onPick: (key: string, f: FieldLike) => void;
  /** Shown as a clear button on hover when given (a field you picked; clearing puts back what Brownout finds). */
  onClear?: () => void;
  /** The logs the field should be in (default: every open log). */
  logs?: LogEntry[];
  testId?: string;
  /** One line, no label line (in a toolbar). */
  inline?: boolean;
  /** The panel it belongs to: pointing at it lights its field in the field list. */
  panel?: string;
  /** What an empty box says. */
  placeholder?: ReactNode;
  className?: string;
}) {
  const allLogs = useStore(sessionStore, (s) => s.logs);
  const logs = logsProp ?? allLogs;
  const fit = useDragFit(spec);
  const [over, setOver] = useState<FieldDrag | null>(null);
  const [typing, setTyping] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [shaking, shake, unshake] = useShake();
  const boxRef = useRef<HTMLDivElement>(null);

  const overOk = over && specAccepts(spec, over);
  const overBad = over && !overOk;
  const miss = missingFrom(value, logs);
  const types = specLabel(spec);

  // a reason stays up a moment after a rejected drop or Tab
  useEffect(() => {
    if (!reason || overBad) return;
    const t = window.setTimeout(() => setReason(null), 3500);
    return () => window.clearTimeout(t);
  }, [reason, overBad]);
  useEffect(() => {
    if (fit === null) setOver(null);
  }, [fit]);

  const pick = (f: FieldLike) => {
    setTyping(false);
    setReason(null);
    onPick(f.key, f);
  };
  const reject = (f: FieldLike) => {
    if (spec) setReason(specReason(spec, f));
    shake();
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!hasFieldDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    const d = dragStore.get().items?.[0] ?? null;
    if (d && d !== over) {
      setOver(d);
      if (!specAccepts(spec, d) && spec) setReason(specReason(spec, d));
    }
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      setOver(null);
      if (overBad) setReason(null);
    }
  };
  const onDrop = (e: React.DragEvent) => {
    const items = readFieldDrag(e);
    setOver(null);
    if (!items) return;
    e.preventDefault();
    e.stopPropagation();
    if (specAccepts(spec, items[0])) pick(items[0]);
    else reject(items[0]);
  };

  const state = typing ? 'typing' : overBad ? 'bad' : overOk ? 'over' : fit === 'ok' ? 'lit' : miss.length ? 'missing' : value ? 'filled' : 'empty';
  const shown = overOk ? over!.key : value;
  const title = typing ? undefined : overBad || reason ? (reason ?? undefined) : miss.length ? `${value}\n${missingText(miss, logs)}` : value;

  return (
    <div className={`fslot-wrap${inline ? ' inline' : ''}${state === 'bad' || reason ? ' bad' : ''} ${className}`} data-testid={testId} data-state={state}>
      {!inline && (label || types) && (
        <div className="fslot-label">
          <span className="fslot-name">{label}</span>
          {types && (
            <span className="fslot-types" title={types}>
              {types}
            </span>
          )}
        </div>
      )}
      <div
        ref={boxRef}
        className={`fslot ${state}${!value && !typing && !overOk ? ' empty' : ''}${shaking ? ' shake' : ''}`}
        onDragEnter={onDragOver}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onAnimationEnd={unshake}
        onClick={() => !typing && setTyping(true)}
        title={title}
        tabIndex={typing ? -1 : 0}
        onKeyDown={(e) => {
          if (!typing && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setTyping(true);
          }
        }}
        role="button"
        onMouseEnter={panel && value ? () => pointAtField(value, panel) : undefined}
        onMouseLeave={panel && value ? () => pointAtField(null) : undefined}
        data-testid={testId ? `${testId}-box` : undefined}
      >
        {typing ? (
          <FieldSearchInput
            anchor={boxRef}
            spec={spec}
            onPick={pick}
            onReject={reject}
            onClose={() => (setTyping(false), setReason(null))}
            onEdit={() => setReason(null)}
          />
        ) : shown ? (
          <KeyText k={shown} />
        ) : (
          <span className="fslot-none">{placeholder}</span>
        )}
        {onClear && value && !typing && !over && (
          <button
            className="chip-btn fslot-clear"
            title="Clear"
            aria-label="Clear"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
          >
            <Icon name="close" size={10} />
          </button>
        )}
        {reason && <span className="fslot-tip">{reason}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Typing with Tab completion, and the list under the box

function FieldSearchInput({
  anchor,
  spec,
  onPick,
  onReject,
  onClose,
  onEdit,
}: {
  anchor: React.RefObject<HTMLElement | null>;
  spec?: FieldSpec;
  onPick: (f: FieldLike) => void;
  onReject: (f: FieldLike) => void;
  onClose: () => void;
  /** The text changed (a shown reason no longer applies). */
  onEdit?: () => void;
}) {
  const fields = useFieldIndex();
  const logs = useStore(sessionStore, (s) => s.logs);
  const [q, setQ] = useState('');
  const [hl, setHl] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const fits = (f: FieldLike) => specAccepts(spec, f);
  const all = useMemo(() => [...fields.values()], [fields]);
  const completion = useMemo(() => completeKey(q, all, fits), [q, all, spec]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => {
    const out: MergedField[] = [];
    for (const f of all) {
      if (!fits(f) || !keyMatchesSearch(f.key, q)) continue;
      out.push(f);
      if (out.length >= LIST_MAX) break;
    }
    return groupByFolder(out);
  }, [all, q, spec]); // eslint-disable-line react-hooks/exhaustive-deps
  const flat = useMemo(() => groupFields(groups), [groups]);
  const cur = flat[Math.min(hl, flat.length - 1)];

  // keep the highlighted row in view
  useEffect(() => {
    listRef.current?.querySelector('.fsearch-row.hl')?.scrollIntoView({ block: 'nearest' });
  }, [hl, flat]);

  // close on a click anywhere else
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchor.current?.contains(t) || listRef.current?.contains(t)) return;
      onClose();
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [anchor, onClose]);

  const edit = (text: string) => {
    setQ(text);
    setHl(0);
    onEdit?.();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHl((h) => Math.min(flat.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHl((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const exact = fields.get(q);
      if (exact) (fits(exact) ? onPick : onReject)(exact);
      else if (cur) onPick(cur);
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      if (completion) {
        const f = completion.field;
        if (fits(f)) onPick(f);
        else {
          // the text becomes the field, to edit; the list stays open with what fits
          setQ(f.key);
          setHl(0);
          onReject(f);
        }
      } else if (cur) onPick(cur);
    }
  };

  return (
    <span className="search-field fslot-input">
      {completion && completion.rest && (
        <span className="search-ghost" aria-hidden>
          <span className="search-ghost-typed">{q}</span>
          {completion.rest}
          <span className="search-ghost-key">Tab</span>
        </span>
      )}
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => edit(e.target.value)}
        onKeyDown={onKey}
        spellCheck={false}
        data-testid="fslot-input"
        aria-label="Field"
      />
      <FloatingList anchor={anchor} listRef={listRef}>
        <FolderGroups
          groups={groups}
          row={(f, name) => (
            <div
              className={`fsearch-row${f === cur ? ' hl' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHl(flat.indexOf(f))}
              onClick={() => onPick(f)}
              title={f.key}
              data-testid="fsearch-row"
            >
              <span className="fsearch-name">
                <KeyText k={name} />
              </span>
              <span className="kind-badge">{typeLabel(f)}</span>
              {logs.length > 1 && (
                <span className="log-dots">
                  {logs.map((l) => (
                    <span key={l.id} className="dot" style={{ background: f.logIds.includes(l.id) ? l.color : 'transparent', borderColor: l.color }} />
                  ))}
                </span>
              )}
            </div>
          )}
        />
        {!flat.length && <div className="hint">{logs.length ? 'No fields fit.' : 'No logs open.'}</div>}
      </FloatingList>
    </span>
  );
}

/** A list drawn on the page's top layer under its anchor, so toolbars and panels can't clip it. */
function FloatingList({
  anchor,
  listRef,
  children,
}: {
  anchor: React.RefObject<HTMLElement | null>;
  listRef: React.RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current;
      const m = listRef.current;
      if (!a || !m) return;
      const r = a.getBoundingClientRect();
      const vh = window.innerHeight;
      const w = Math.max(r.width, 280);
      m.style.width = `${Math.round(Math.min(w, window.innerWidth - 12))}px`;
      m.style.left = `${Math.round(Math.max(6, Math.min(r.left, window.innerWidth - w - 6)))}px`;
      const below = vh - r.bottom - 10;
      const above = r.top - 10;
      if (below < 160 && above > below) {
        m.style.top = 'auto';
        m.style.bottom = `${Math.round(vh - r.top + 3)}px`;
        m.style.maxHeight = `${Math.round(Math.min(360, above))}px`;
      } else {
        m.style.bottom = 'auto';
        m.style.top = `${Math.round(r.bottom + 3)}px`;
        m.style.maxHeight = `${Math.round(Math.min(360, below))}px`;
      }
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  });
  return createPortal(
    <div ref={listRef} className="fsearch" role="listbox" data-testid="fsearch">
      {children}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Several fields: chips with a + Field chip at the end

export interface FieldListItem {
  key: string;
  /** The line, marker or color the field is drawn with. */
  swatch?: ReactNode;
  /** Controls at the end of the chip (an axis toggle). */
  extra?: ReactNode;
  /** A line added to the chip's tooltip. */
  note?: string;
}

export function FieldList({
  items,
  spec,
  onInsert,
  onReplace,
  onRemove,
  logs: logsProp,
  testId,
  addLabel = 'Field',
  panel,
  className = '',
  lead,
}: {
  items: FieldListItem[];
  spec?: FieldSpec;
  /** Add fields at this index (items.length for the end). */
  onInsert: (index: number, fields: FieldLike[]) => void;
  /** Swap the field at this index (it keeps its place and style). */
  onReplace?: (index: number, f: FieldLike) => void;
  onRemove: (index: number) => void;
  logs?: LogEntry[];
  testId?: string;
  addLabel?: string;
  /** The panel the list belongs to: pointing at a chip lights its field in the field list (and its line). */
  panel?: string;
  className?: string;
  /** Chips shown first that are not part of the list (the 2D field's robot, path and cameras); they wrap with it. */
  lead?: ReactNode;
}) {
  const linked = useStore(linkStore, (s) => (s.panel === panel ? null : s.key));
  const allLogs = useStore(sessionStore, (s) => s.logs);
  const logs = logsProp ?? allLogs;
  const fit = useDragFit(spec);
  /** Where the pointer is while dragging: on a chip (swap), at a gap before index (insert), or on + Field. */
  const [over, setOver] = useState<{ at: number; mode: 'swap' | 'gap' | 'add'; field: FieldDrag } | null>(null);
  const [typing, setTyping] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [shakeAt, setShakeAt] = useState<number | null>(null);
  const addRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (fit === null) setOver(null);
  }, [fit]);
  useEffect(() => {
    if (!reason || over) return;
    const t = window.setTimeout(() => setReason(null), 3500);
    return () => window.clearTimeout(t);
  }, [reason, over]);

  const accepted = (fs: FieldDrag[]) => fs.filter((f) => specAccepts(spec, f));
  const reject = (at: number, f: FieldLike) => {
    if (spec) setReason(specReason(spec, f));
    setShakeAt(null);
    requestAnimationFrame(() => setShakeAt(at));
  };

  const where = (e: React.DragEvent, i: number): 'swap' | 'gap' => {
    if (!onReplace) return 'gap';
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    return x < 0.22 || x > 0.78 ? 'gap' : 'swap';
  };
  const gapIndex = (e: React.DragEvent, i: number) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientX - r.left < r.width / 2 ? i : i + 1;
  };

  const dragOver = (e: React.DragEvent, at: number, mode: 'swap' | 'gap' | 'add') => {
    if (!hasFieldDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    const d = dragStore.get().items?.[0];
    if (!d) return;
    if (!over || over.at !== at || over.mode !== mode || over.field !== d) {
      setOver({ at, mode, field: d });
      if (spec && !specAccepts(spec, d)) setReason(specReason(spec, d));
    }
  };
  const leave = (e: React.DragEvent) => {
    if (!(e.currentTarget as HTMLElement).closest('.flist')?.contains(e.relatedTarget as Node)) setOver(null);
  };
  const drop = (e: React.DragEvent, at: number, mode: 'swap' | 'gap' | 'add') => {
    const dropped = readFieldDrag(e);
    setOver(null);
    if (!dropped) return;
    e.preventDefault();
    e.stopPropagation();
    const ok = accepted(dropped);
    if (mode === 'swap' && onReplace) {
      if (ok.length && ok[0] === dropped[0]) onReplace(at, dropped[0]);
      else reject(at, dropped[0]);
      return;
    }
    if (!ok.length) {
      reject(mode === 'add' ? items.length : at, dropped[0]);
      return;
    }
    onInsert(at, ok);
  };

  const overBad = over && !specAccepts(spec, over.field);

  return (
    <div
      className={`flist${fit === 'ok' ? ' lit' : ''} ${className}`}
      data-testid={testId}
      onDragEnter={(e) => dragOver(e, items.length, 'add')}
      onDragOver={(e) => dragOver(e, items.length, 'add')}
      onDragLeave={leave}
      onDrop={(e) => drop(e, items.length, 'add')}
    >
      {lead}
      {items.map((it, i) => {
        const miss = missingFrom(it.key, logs);
        const swapping = over && over.mode === 'swap' && over.at === i;
        const gapBefore = over && over.mode === 'gap' && over.at === i && !overBad;
        const gapAfter = over && over.mode === 'gap' && over.at === i + 1 && i === items.length - 1 && !overBad;
        const bad = swapping && overBad;
        return (
          <span
            key={`${it.key}|${i}`}
            className={`chip fchip${it.key === linked ? ' linked' : ''}${miss.length ? ' missing' : ''}${swapping ? (bad ? ' bad' : ' over') : ''}${gapBefore ? ' gap-before' : ''}${gapAfter ? ' gap-after' : ''}${shakeAt === i ? ' shake' : ''}`}
            title={bad ? (reason ?? undefined) : [it.key, miss.length ? missingText(miss, logs) : '', it.note ?? ''].filter(Boolean).join('\n')}
            onDragEnter={(e) => {
              const m = where(e, i);
              dragOver(e, m === 'gap' ? gapIndex(e, i) : i, m);
            }}
            onDragOver={(e) => {
              const m = where(e, i);
              dragOver(e, m === 'gap' ? gapIndex(e, i) : i, m);
            }}
            onDrop={(e) => {
              const m = where(e, i);
              drop(e, m === 'gap' ? gapIndex(e, i) : i, m);
            }}
            onAnimationEnd={() => setShakeAt(null)}
            onMouseEnter={panel ? () => pointAtField(it.key, panel) : undefined}
            onMouseLeave={panel ? () => pointAtField(null) : undefined}
            data-testid="fchip"
            data-key={it.key}
          >
            {it.swatch}
            <KeyText k={swapping && !bad ? over!.field.key : it.key} />
            {it.extra}
            <button className="chip-btn" title="Remove" aria-label="Remove" onClick={() => onRemove(i)}>
              <Icon name="close" size={10} />
            </button>
          </span>
        );
      })}
      <span
        ref={addRef}
        className={`chip fchip add${typing ? ' typing' : ''}${over?.mode === 'add' ? (overBad ? ' bad' : ' over') : ''}${shakeAt === items.length ? ' shake' : ''}`}
        onClick={() => !typing && setTyping(true)}
        onDragEnter={(e) => dragOver(e, items.length, 'add')}
        onDragOver={(e) => dragOver(e, items.length, 'add')}
        onDrop={(e) => drop(e, items.length, 'add')}
        onAnimationEnd={() => setShakeAt(null)}
        role="button"
        tabIndex={typing ? -1 : 0}
        onKeyDown={(e) => {
          if (!typing && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setTyping(true);
          }
        }}
        title={over?.mode === 'add' && overBad ? (reason ?? undefined) : undefined}
        data-testid={testId ? `${testId}-add` : 'fchip-add'}
      >
        {typing ? (
          <FieldSearchInput
            anchor={addRef}
            spec={spec}
            onPick={(f) => {
              setTyping(false);
              setReason(null);
              onInsert(items.length, [f]);
            }}
            onReject={(f) => reject(items.length, f)}
            onClose={() => (setTyping(false), setReason(null))}
            onEdit={() => setReason(null)}
          />
        ) : over?.mode === 'add' && !overBad ? (
          <KeyText k={over.field.key} />
        ) : (
          <>
            <Icon name="plus" size={10} /> {addLabel}
          </>
        )}
      </span>
      {reason && <span className="fslot-tip in-list">{reason}</span>}
    </div>
  );
}
