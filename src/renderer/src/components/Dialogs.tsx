/** Renders the in-app dialogs and toasts from uiStore. */
import { useEffect, useRef, useState } from 'react';
import { uiStore, closeDialog, dismissToast, type Dialog, type TextDialog, type ChoiceDialog, type ChecklistDialog } from '../state/ui';
import { useStore } from '../state/store';
import { Icon } from './Icon';

export function DialogHost() {
  const dialog = useStore(uiStore, (s) => s.dialogs[0]) as Dialog | undefined;
  if (!dialog) return null;
  // key forces a fresh component per dialog so inputs don't carry over
  if (dialog.kind === 'text') return <TextDialogView key={dialog.title + dialog.initial} d={dialog} />;
  if (dialog.kind === 'choice') return <ChoiceDialogView key={dialog.title + dialog.message} d={dialog} />;
  return <ChecklistDialogView key={dialog.title} d={dialog} />;
}

function Frame({ title, onCancel, children }: { title: string; onCancel: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);
  return (
    <div className="modal-backdrop dialog-backdrop" onMouseDown={onCancel}>
      <div className="modal dialog" role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-title">{title}</div>
        {children}
      </div>
    </div>
  );
}

function TextDialogView({ d }: { d: TextDialog }) {
  const [value, setValue] = useState(d.initial ?? '');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const error = d.validate ? d.validate(value) : null;
  const done = (v: string | null) => {
    closeDialog();
    d.resolve(v);
  };
  return (
    <Frame title={d.title} onCancel={() => done(null)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!error) done(value);
        }}
      >
        {d.label && <label className="dialog-label">{d.label}</label>}
        <input ref={ref} className="dialog-input" value={value} placeholder={d.placeholder} onChange={(e) => setValue(e.target.value)} />
        <div className="dialog-error">{value && error ? error : ' '}</div>
        <div className="dialog-buttons">
          <button type="button" className="btn" onClick={() => done(null)}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!!error}>
            {d.confirmLabel ?? 'OK'}
          </button>
        </div>
      </form>
    </Frame>
  );
}

function ChoiceDialogView({ d }: { d: ChoiceDialog }) {
  const [checked, setChecked] = useState(false);
  const done = (id: string | null) => {
    closeDialog();
    d.resolve({ id, checked });
  };
  return (
    <Frame title={d.title} onCancel={() => done(null)}>
      <div className="dialog-message">{d.message}</div>
      {d.checkbox && (
        <label className="dialog-check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> {d.checkbox}
        </label>
      )}
      <div className="dialog-buttons">
        {d.options.map((o) => (
          <button
            key={o.id}
            type="button"
            autoFocus={o.primary}
            className={`btn${o.primary ? ' primary' : ''}${o.danger ? ' danger' : ''}`}
            onClick={() => done(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </Frame>
  );
}

function ChecklistDialogView({ d }: { d: ChecklistDialog }) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(d.items.filter((i) => i.checked).map((i) => i.id)));
  const done = (ids: string[] | null) => {
    closeDialog();
    d.resolve(ids);
  };
  return (
    <Frame title={d.title} onCancel={() => done(null)}>
      {d.message && <div className="dialog-message">{d.message}</div>}
      <div className="dialog-list">
        {d.items.map((i) => (
          <label key={i.id} className="dialog-check">
            <input
              type="checkbox"
              checked={sel.has(i.id)}
              onChange={(e) =>
                setSel((s) => {
                  const n = new Set(s);
                  if (e.target.checked) n.add(i.id);
                  else n.delete(i.id);
                  return n;
                })
              }
            />{' '}
            {i.label}
          </label>
        ))}
      </div>
      <div className="dialog-buttons">
        <button type="button" className="btn" onClick={() => setSel(sel.size === d.items.length ? new Set() : new Set(d.items.map((i) => i.id)))}>
          {sel.size === d.items.length ? 'Select none' : 'Select all'}
        </button>
        <span className="toolbar-spacer" />
        <button type="button" className="btn" onClick={() => done(null)}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={sel.size === 0} onClick={() => done(d.items.filter((i) => sel.has(i.id)).map((i) => i.id))}>
          {d.confirmLabel}
        </button>
      </div>
    </Frame>
  );
}

export function ToastHost() {
  const toasts = useStore(uiStore, (s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span className="toast-text">{t.text}</span>
          {t.actions?.map((a) => (
            <button
              key={a.label}
              className="btn small"
              onClick={() => {
                dismissToast(t.id);
                a.run();
              }}
            >
              {a.label}
            </button>
          ))}
          <button className="chip-btn" title="Dismiss" onClick={() => dismissToast(t.id)}>
            <Icon name="close" size={10} />
          </button>
        </div>
      ))}
    </div>
  );
}
