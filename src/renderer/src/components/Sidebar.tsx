/**
 * Sidebar: favorites, the field tree (search, type/unit badges, per-log
 * dots) and the inspector that shows selected fields' values at the cursor.
 *
 * Selecting works like a file list: click selects one field, Ctrl-click adds
 * or removes one, Shift-click selects a range. Dragging a selected field
 * drags the whole selection; dragging a folder takes every field inside it.
 * Double-click adds a field to the active panel.
 *
 * The search narrows by name, and by type: while typing a word, the type it
 * could finish as (one that exists in the open logs: "Pose2d", "boolean")
 * shows faintly; Tab turns it into a type filter, and typing goes on. Several
 * types show any of them; words must all appear in the name. Backspace on an
 * empty search removes the last type. Drag the sidebar's right edge to make
 * it wider (double-click it for the default width).
 */
import { useMemo, useRef, useState } from 'react';
import { sessionStore, toggleSelectedKey, setSelectedKeys, addTimelineTrack, activeProfileId, SIDEBAR_MIN } from '../state/session';
import { timeStore } from '../state/time';
import { useStore } from '../state/store';
import { panelStore, addFieldToPanel, addFieldsToPanel, panelAccepts, panelTypeForField, PANEL_TITLES } from '../state/panels';
import { profileStore, profileById, updateProfile } from '../state/profiles';
import { grid } from './Grid';
import { useFieldIndex, keyMatchesSearch, shortKey, typeLabels, completeType, typeMatches, typeLabel, groupByFolder, type MergedField } from '../lib/fields';
import { setFieldDrag, type FieldDrag } from '../lib/dnd';
import { client } from '../worker/client';
import { useSeriesTick } from '../lib/useSeries';
import { indexAtOrBefore } from '@core/log';
import { formatValue } from '../lib/format';
import { toast } from '../state/ui';
import { Icon } from './Icon';
import { InPanels } from './InPanels';
import { useFieldPanels, linkStore, pointAtField, panelColorVar, inPanelsStore } from '../lib/panelLinks';

interface Node {
  name: string;
  path: string;
  children: Map<string, Node>;
  field?: MergedField;
  count: number;
}

const MAX_DRAG = 100;
const INSPECTOR_MAX = 8;

function buildTree(fields: Map<string, MergedField>): Node {
  const root: Node = { name: '', path: '', children: new Map(), count: 0 };
  for (const f of fields.values()) {
    const parts = f.key.split('/').filter(Boolean);
    let cur = root;
    let path = '';
    for (let i = 0; i < parts.length; i++) {
      path += (path ? '/' : '') + parts[i];
      let next = cur.children.get(parts[i]);
      if (!next) {
        next = { name: parts[i], path, children: new Map(), count: 0 };
        cur.children.set(parts[i], next);
      }
      cur = next;
      cur.count++;
    }
    cur.field = f;
  }
  return root;
}

function sortedChildren(n: Node): Node[] {
  return [...n.children.values()].sort((a, b) => {
    const ad = a.children.size > 0 ? 0 : 1;
    const bd = b.children.size > 0 ? 0 : 1;
    if (ad !== bd) return ad - bd;
    const na = Number(a.name);
    const nb = Number(b.name);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a.name.localeCompare(b.name);
  });
}

/** The fields a folder stands for when dragged: every logged field under it (struct and array parents, not their generated children). */
function fieldsUnder(n: Node): MergedField[] {
  const real: MergedField[] = [];
  const generated: MergedField[] = [];
  const walk = (x: Node) => {
    if (x.field) (x.field.generated ? generated : real).push(x.field);
    for (const c of sortedChildren(x)) walk(c);
  };
  walk(n);
  return real.length ? real : generated;
}

const asDrag = (f: MergedField): FieldDrag => ({ key: f.key, kind: f.kind, structName: f.structName });

/** Tell the user what a multi-field add did. */
export function reportAdd(total: number, added: number, skipped: { key: string }[], panelTitle: string): void {
  if (total <= 1 && !skipped.length) return;
  if (!skipped.length) {
    toast(`Added ${added} fields to ${panelTitle}.`);
    return;
  }
  const names = skipped
    .slice(0, 3)
    .map((s) => shortKey(s.key))
    .join(', ');
  const more = skipped.length > 3 ? ` and ${skipped.length - 3} more` : '';
  toast(`Added ${added} of ${total} to ${panelTitle}. Skipped ${skipped.length} it can't show: ${names}${more}.`, added ? 'info' : 'error', undefined, 7000);
}

/** Add fields to the active panel when it accepts the first one, else open the best panel type for them. */
export function smartAddMany(fields: MergedField[], forceNew = false): void {
  if (!fields.length) return;
  let rest = fields.map(asDrag);
  const active = grid.activePanelId();
  const ps = active ? panelStore.get().panels[active] : undefined;
  if (!forceNew && active && ps && panelAccepts(ps.type, rest[0].kind, rest[0].structName)) {
    const r = addFieldsToPanel(active, rest);
    reportAdd(rest.length, r.added, r.skipped, PANEL_TITLES[ps.type]);
    return;
  }
  // one new panel per kind of field, so nothing is dropped
  const total = rest.length;
  let panels = 0;
  while (rest.length && panels < 4) {
    const type = panelTypeForField(rest[0].kind, rest[0].structName, rest[0].key);
    const id = grid.addPanel(type);
    const r = addFieldsToPanel(id, rest);
    if (!r.added) {
      addFieldToPanel(id, rest[0].key, rest[0].kind, rest[0].structName);
      break;
    }
    rest = r.skipped;
    panels++;
  }
  if (total > 1) toast(`Opened ${total - rest.length} fields in ${panels} new panel${panels === 1 ? '' : 's'}.`);
}

export function smartAdd(f: MergedField, forceNew = false): void {
  smartAddMany([f], forceNew);
}

export function toggleFavorite(key: string): void {
  updateProfile(activeProfileId(), (p) => ({ favorites: p.favorites.includes(key) ? p.favorites.filter((k) => k !== key) : [...p.favorites, key] }));
}

export function Sidebar() {
  const fields = useFieldIndex();
  const logs = useStore(sessionStore, (s) => s.logs);
  const selected = useStore(sessionStore, (s) => s.selectedKeys);
  const profileId = useStore(sessionStore, (s) => s.logs[0]?.profileId);
  const profiles = useStore(profileStore, (s) => s.profiles);
  const favorites = (profiles.find((p) => p.id === profileId) ?? profileById(profileId)).favorites;
  const [q, setQ] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const width = useStore(sessionStore, (s) => s.sidebarWidth);
  const labels = useMemo(() => typeLabels(fields.values()), [fields]);
  // the word being typed, and the type it could finish as
  const word = /(\S+)$/.exec(q)?.[1] ?? '';
  const completion = completeType(
    word,
    labels.filter((t) => !types.includes(t)),
  );
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [favOpen, setFavOpen] = useState(true);
  const [showGenerated, setShowGenerated] = useState(true);
  const inPanels = useStore(inPanelsStore, (s) => s.on);
  const fieldPanels = useFieldPanels();
  const tree = useMemo(() => buildTree(fields), [fields]);
  const anchor = useRef<string | null>(null);
  /** Field keys in the order they are on screen, for Shift-click ranges. */
  const order = useRef<string[]>([]);
  order.current = [];

  const toggle = (path: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });

  const flat = useMemo(() => {
    if (!q.trim() && !types.length) return null;
    const out: MergedField[] = [];
    for (const f of fields.values()) {
      if (!showGenerated && f.generated) continue;
      if (typeMatches(f, types) && keyMatchesSearch(f.key, q)) out.push(f);
      if (out.length > 500) break;
    }
    return out;
  }, [q, types, fields, showGenerated]);

  // search results that share a folder: the folder once above them, each row only the part that differs
  const groups = useMemo(() => (flat ? groupByFolder(flat) : null), [flat]);

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab' && !e.shiftKey && completion) {
      // the word becomes a type filter; keep typing for the next one
      e.preventDefault();
      setTypes((t) => [...t, completion]);
      setQ(q.slice(0, q.length - word.length));
    } else if (e.key === 'Backspace' && !q && types.length) {
      e.preventDefault();
      setTypes((t) => t.slice(0, -1));
    } else if (e.key === 'Escape' && (q || types.length)) {
      e.stopPropagation();
      setQ('');
      setTypes([]);
    }
  };

  // Drag the right edge to make the sidebar wider or narrower
  const onResizeDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    const startX = e.clientX;
    const startW = (el.parentElement as HTMLElement).getBoundingClientRect().width;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const w = Math.round(Math.min(window.innerWidth * 0.6, Math.max(SIDEBAR_MIN, startW + ev.clientX - startX)));
      sessionStore.set({ sidebarWidth: w });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const onRowClick = (e: React.MouseEvent, key: string) => {
    if (e.shiftKey && anchor.current && order.current.includes(anchor.current)) {
      const a = order.current.indexOf(anchor.current);
      const b = order.current.indexOf(key);
      const range = order.current.slice(Math.min(a, b), Math.max(a, b) + 1);
      setSelectedKeys(e.ctrlKey || e.metaKey ? [...new Set([...selected, ...range])] : range);
      return;
    }
    anchor.current = key;
    toggleSelectedKey(key, !e.ctrlKey && !e.metaKey);
  };

  const onRowDrag = (e: React.DragEvent, f: MergedField) => {
    // dragging a selected row takes the whole selection, in on-screen order
    if (selected.length > 1 && selected.includes(f.key)) {
      const keys = order.current.filter((k) => selected.includes(k));
      for (const k of selected) if (!keys.includes(k)) keys.push(k);
      const items = keys.map((k) => fields.get(k)).filter((x): x is MergedField => !!x);
      setFieldDrag(e, items.slice(0, MAX_DRAG).map(asDrag));
    } else setFieldDrag(e, [asDrag(f)]);
  };

  const onFolderDrag = (e: React.DragEvent, n: Node) => {
    const all = fieldsUnder(n).filter((f) => showGenerated || !f.generated);
    if (!all.length) {
      e.preventDefault();
      return;
    }
    if (all.length > MAX_DRAG) toast(`“${n.name}” holds ${all.length} fields; dragging the first ${MAX_DRAG}.`);
    setFieldDrag(e, all.slice(0, MAX_DRAG).map(asDrag));
  };

  const row = (f: MergedField, name: string, depth: number, keyPrefix = '', folder?: string) => {
    order.current.push(f.key);
    return (
      <FieldRow
        key={keyPrefix + f.key}
        f={f}
        name={name}
        folder={folder}
        depth={depth}
        logs={logs}
        selected={selected.includes(f.key)}
        favorite={favorites.includes(f.key)}
        panels={fieldPanels.get(f.key)}
        onClick={onRowClick}
        onDrag={onRowDrag}
        addSelection={() =>
          smartAddMany(selected.length > 1 && selected.includes(f.key) ? (selected.map((k) => fields.get(k)).filter(Boolean) as MergedField[]) : [f])
        }
      />
    );
  };

  const renderNode = (n: Node, depth: number): React.ReactNode => {
    const kids = sortedChildren(n);
    return kids.map((c) => {
      if (c.field && c.children.size === 0) {
        if (!showGenerated && c.field.generated) return null;
        return row(c.field, c.name, depth);
      }
      const isOpen = open.has(c.path);
      return (
        <div key={c.path}>
          <div
            className="tree-row folder"
            style={{ paddingLeft: 6 + depth * 12 }}
            onClick={() => toggle(c.path)}
            draggable
            onDragStart={(e) => onFolderDrag(e, c)}
            title={`${c.count} fields · drag onto a panel to add them all`}
          >
            <span className="caret">
              <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={10} />
            </span>
            <span className="name">{c.name}</span>
            <span className="count">{c.count}</span>
            {c.field && <span className="kind-badge">{typeLabel(c.field)}</span>}
          </div>
          {c.field && isOpen && row(c.field, `(${typeLabel(c.field)})`, depth + 1)}
          {isOpen && renderNode(c, depth + 1)}
        </div>
      );
    });
  };

  const favFields = favorites.map((k) => fields.get(k)).filter((f): f is MergedField => !!f);
  const favMissing = favorites.length - favFields.length;

  return (
    <div className="sidebar" style={width ? { width } : undefined}>
      <div
        className="sidebar-resizer"
        onPointerDown={onResizeDown}
        onDoubleClick={() => sessionStore.set({ sidebarWidth: null })}
        title="Drag to make the field list wider or narrower · double-click for the default width"
        data-testid="sidebar-resizer"
      />
      <div className="sidebar-head">
        <div className="search search-box" data-testid="field-search">
          {types.map((t) => (
            <span key={t} className="type-chip" data-testid="type-chip">
              {t}
              <button className="chip-btn" title={`Stop filtering by ${t}`} onClick={() => setTypes((x) => x.filter((y) => y !== t))}>
                <Icon name="close" size={9} />
              </button>
            </span>
          ))}
          <span className="search-field">
            {/* the faint rest of the type the word could finish as */}
            {completion && (
              <span className="search-ghost" aria-hidden>
                <span className="search-ghost-typed">{q}</span>
                {completion.slice(word.length)}
                <span className="search-ghost-key">Tab</span>
              </span>
            )}
            <input
              placeholder={types.length ? 'More types or name words…' : 'Search fields, or a type then Tab…'}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onSearchKey}
              spellCheck={false}
              title="Words narrow by name. Start typing a type (Pose2d, boolean, number…) and press Tab to filter by it; Backspace removes the last type."
              data-testid="field-search-input"
            />
          </span>
        </div>
        {!inPanels && (
          <button className={`tool-btn${showGenerated ? ' active' : ''}`} title="Show struct / array children" onClick={() => setShowGenerated(!showGenerated)}>
            {'{}'}
          </button>
        )}
        <button
          className={`tool-btn in-panels-btn${inPanels ? ' active' : ''}`}
          title="Only the fields the panels show, with their values at the cursor"
          onClick={() => inPanelsStore.set({ on: !inPanels })}
          data-testid="in-panels-toggle"
        >
          In panels
        </button>
      </div>
      {inPanels && <InPanels q={q} />}
      <div className="tree scroll" data-testid="field-tree" hidden={inPanels}>
        {logs.length === 0 && <div className="hint">No logs open.</div>}
        {!flat && favorites.length > 0 && logs.length > 0 && (
          <div className="fav-section">
            <div className="tree-row folder" onClick={() => setFavOpen(!favOpen)} title="Starred fields, saved in the robot profile">
              <span className="caret">
                <Icon name={favOpen ? 'chevronDown' : 'chevronRight'} size={10} />
              </span>
              <Icon name="starFilled" size={11} className="fav-star" />
              <span className="name">Favorites</span>
              <span className="count">{favFields.length}</span>
            </div>
            {favOpen && favFields.map((f) => row(f, shortKey(f.key, 3), 1, 'fav:'))}
            {favOpen && favMissing > 0 && (
              <div className="hint fav-missing">
                {favMissing} favorite{favMissing === 1 ? ' is' : 's are'} not in the open logs.
              </div>
            )}
          </div>
        )}
        {groups
          ? groups.map((g) =>
              g.fields.length > 1 ? (
                <div className="search-group" key={`group:${g.folder}`} data-testid="search-group">
                  <div
                    className="search-folder"
                    title={`${g.folder || '(top level)'}\nEvery field in this box is in this folder; each row shows the rest of its name.`}
                  >
                    <Icon name="folder" size={11} />
                    <span className="path">
                      <bdi>{g.folder || '(top level)'}</bdi>
                    </span>
                    <span className="count">{g.fields.length}</span>
                  </div>
                  {g.fields.map((f) => row(f, f.key.slice(g.folder.length), 0))}
                </div>
              ) : (
                row(g.fields[0], g.fields[0].key.slice(g.folder.length), 0, '', g.folder)
              ),
            )
          : renderNode(tree, 0)}
        {flat && flat.length === 0 && <div className="hint">No matches.</div>}
      </div>
      {selected.length > 1 && !inPanels && (
        <div className="selection-bar">
          <span>{selected.length} selected</span>
          <button
            className="link-btn"
            onClick={() => smartAddMany(selected.map((k) => fields.get(k)).filter(Boolean) as MergedField[])}
            title="Add them to the active panel (or open a new one)"
          >
            Add to panel
          </button>
          <button className="link-btn" onClick={() => setSelectedKeys([])}>
            Clear
          </button>
        </div>
      )}
      {!inPanels && <Inspector />}
    </div>
  );
}

function FieldRow({
  f,
  name,
  folder,
  depth,
  logs,
  selected,
  favorite,
  panels,
  onClick,
  onDrag,
  addSelection,
}: {
  f: MergedField;
  name: string;
  /** Shown dimmed before the name (a search result alone in its folder). */
  folder?: string;
  depth: number;
  logs: { id: string; color: string; name: string }[];
  selected: boolean;
  favorite: boolean;
  /** The numbers of the panels showing it. */
  panels?: number[];
  onClick: (e: React.MouseEvent, key: string) => void;
  onDrag: (e: React.DragEvent, f: MergedField) => void;
  addSelection: () => void;
}) {
  // lit while the pointer is on a panel showing it, or on its chip in a panel
  const linked = useStore(linkStore, (s) => s.panel !== null && s.keys.has(f.key));
  return (
    <div
      className={`tree-row field${selected ? ' selected' : ''}${f.generated ? ' generated' : ''}${linked ? ' linked' : ''}`}
      onMouseEnter={panels ? () => pointAtField(f.key) : undefined}
      onMouseLeave={panels ? () => pointAtField(null) : undefined}
      style={{ paddingLeft: 6 + depth * 12 }}
      draggable
      data-key={f.key}
      onDragStart={(e) => onDrag(e, f)}
      onClick={(e) => onClick(e, f.key)}
      onDoubleClick={addSelection}
      title={`${f.key}\n${f.type}${f.unit ? ` · ${f.unit}` : ''} · ${f.count} samples\nDrag onto a panel · double-click to add to the active panel\nCtrl-click and Shift-click select several`}
    >
      {folder ? (
        <span className="name split">
          <span className="key-folder">
            <bdi>{folder}</bdi>
          </span>
          <span className="key-leaf">{name}</span>
        </span>
      ) : (
        <span className="name">{name}</span>
      )}
      {f.unit && <span className="unit">{f.unit}</span>}
      <span className="kind-badge">{typeLabel(f)}</span>
      {panels && (
        <span className="row-pns" data-testid="row-panels">
          {panels.map((n) => (
            <span key={n} className="pn small" style={{ background: panelColorVar(n) }}>
              {n}
            </span>
          ))}
        </span>
      )}
      {logs.length > 1 && (
        <span className="log-dots">
          {logs.map((l) => (
            <span key={l.id} className="dot" style={{ background: f.logIds.includes(l.id) ? l.color : 'transparent', borderColor: l.color }} />
          ))}
        </span>
      )}
      <span className={`row-actions${favorite ? ' has-fav' : ''}`}>
        <button
          className={`chip-btn fav-btn${favorite ? ' on' : ''}`}
          title={favorite ? 'Remove from favorites' : 'Add to favorites (kept at the top, saved in the robot profile)'}
          onClick={(e) => (e.stopPropagation(), toggleFavorite(f.key))}
        >
          <Icon name={favorite ? 'starFilled' : 'star'} size={12} />
        </button>
        <button className="chip-btn hover-only" title="Open in a new panel" onClick={(e) => (e.stopPropagation(), smartAdd(f, true))}>
          <Icon name="plus" size={12} />
        </button>
        {(f.kind === 'boolean' || f.kind === 'string' || f.kind === 'number') && (
          <button className="chip-btn hover-only" title="Add as a timeline track" onClick={(e) => (e.stopPropagation(), addTimelineTrack(f.key))}>
            <Icon name="track" size={12} />
          </button>
        )}
      </span>
    </div>
  );
}

/** Put text on the clipboard and say so. */
function copyText(text: string, what: string): void {
  void navigator.clipboard.writeText(text).then(
    () => toast(`Copied ${what}: ${text.length > 60 ? `${text.slice(0, 60)}…` : text}`),
    () => toast(`Could not copy ${what}.`, 'error'),
  );
}

function Inspector() {
  const selected = useStore(sessionStore, (s) => s.selectedKeys);
  const logs = useStore(sessionStore, (s) => s.logs.filter((l) => l.visible));
  const t = useStore(timeStore, (s) => s.hover ?? s.cursor);
  const fields = useFieldIndex();
  useSeriesTick();
  if (!selected.length) return <div className="inspector hint">Select a field to inspect its value at the cursor.</div>;
  return (
    <div className="inspector">
      {selected.slice(0, INSPECTOR_MAX).map((key) => {
        const f = fields.get(key);
        return (
          <div key={key} className="insp-field">
            <div className="insp-key" title={`${key}\nClick to copy the name`}>
              <span className="copyable" onClick={() => copyText(key, 'the field name')} data-testid="insp-key">
                {key}
              </span>
              <button className="chip-btn" onClick={() => toggleSelectedKey(key)} title="Deselect">
                <Icon name="close" size={10} />
              </button>
            </div>
            {logs.map((l) => {
              const s = client.peekSeries(l.id, key);
              let text = '…';
              /** The value in full, for copying (the shown text may be rounded). */
              let raw: string | null = null;
              if (s === null) text = 'not in this log';
              else if (s && t !== null) {
                const i = indexAtOrBefore(s.t, t - l.offset);
                const v = i < 0 ? undefined : s.kind === 'boolean' ? !!s.v[i] : s.v[i];
                text = v === undefined ? '— (before first sample)' : formatValue(v, f?.unit);
                if (v !== undefined) raw = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v);
              } else if (s && t === null) text = 'set the cursor';
              return (
                <div key={l.id} className="insp-val">
                  <span className="dot" style={{ background: l.color }} />
                  {raw !== null ? (
                    <span className="mono copyable" title="Click to copy the value" onClick={() => copyText(raw!, 'the value')} data-testid="insp-value">
                      {text}
                    </span>
                  ) : (
                    <span className="mono">{text}</span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      {selected.length > INSPECTOR_MAX && <div className="hint">{selected.length - INSPECTOR_MAX} more selected fields are not shown here.</div>}
    </div>
  );
}
