/** A searchable modal list of every field across the open logs. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFieldIndex, keyMatchesSearch, type MergedField } from '../lib/fields';
import { sessionStore } from '../state/session';
import { useStore } from '../state/store';
import { Icon } from './Icon';

export function FieldPicker({
  onPick,
  onClose,
  filter,
  title,
}: {
  onPick: (key: string, f: MergedField) => void;
  onClose: () => void;
  filter?: (f: MergedField) => boolean;
  title?: string;
}) {
  const fields = useFieldIndex();
  const logs = useStore(sessionStore, (s) => s.logs);
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const list = useMemo(() => {
    const out: MergedField[] = [];
    for (const f of fields.values()) {
      if (filter && !filter(f)) continue;
      if (!keyMatchesSearch(f.key, q)) continue;
      out.push(f);
      if (out.length >= 400) break;
    }
    return out;
  }, [fields, q, filter]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>{title ?? 'Add field'}</strong>
          <input
            ref={inputRef}
            placeholder="Search fields… (space-separated words)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
          />
          <button onClick={onClose} title="Close" aria-label="Close">
            <Icon name="close" size={12} />
          </button>
        </div>
        <div className="modal-list">
          {list.map((f) => (
            <div
              key={f.key}
              className="modal-row"
              onClick={() => {
                onPick(f.key, f);
                onClose();
              }}
            >
              <span className="kind-badge">{f.structName ?? f.kind}</span>
              <span className="row-key">{f.key}</span>
              {f.unit && <span className="unit">{f.unit}</span>}
              <span className="log-dots">
                {logs.map((l) => (
                  <span
                    key={l.id}
                    className="dot"
                    style={{ background: f.logIds.includes(l.id) ? l.color : 'transparent', borderColor: l.color }}
                    title={l.name}
                  />
                ))}
              </span>
            </div>
          ))}
          {list.length === 0 && <div className="modal-empty">No fields match.</div>}
        </div>
      </div>
    </div>
  );
}
