/** Drag-and-drop of one or many fields from the sidebar into panels and field boxes. */
import { createStore } from '../state/store';

export const FIELD_MIME = 'application/x-brownout-field';

export interface FieldDrag {
  key: string;
  kind: string;
  structName?: string;
}

/**
 * The fields being dragged right now, or null. A drop target can't read the
 * dragged data until the drop, so every field box reads this to light up when
 * it could take them. Only the start and the end of a drag change it, so
 * moving the pointer re-renders nothing.
 */
export const dragStore = createStore<{ items: FieldDrag[] | null }>({ items: null });

let listening = false;
function listen(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  const end = () => window.setTimeout(() => dragStore.set({ items: null }), 0);
  window.addEventListener('dragend', end, true);
  // after a drop the handlers run first, then the highlight goes
  window.addEventListener('drop', end, true);
  // the source row can unmount mid-drag (its dragend is lost); the first pointer move after the drag cleans up
  window.addEventListener('pointermove', () => dragStore.get().items && dragStore.set({ items: null }), true);
}

/** Start dragging fields. More than one shows a count badge next to the pointer. */
export function setFieldDrag(e: React.DragEvent, items: FieldDrag[]): void {
  e.dataTransfer.setData(FIELD_MIME, JSON.stringify({ items }));
  e.dataTransfer.setData('text/plain', items.map((d) => d.key).join('\n'));
  e.dataTransfer.effectAllowed = 'copy';
  listen();
  // set after this tick: changing the page while the drag starts can cancel it
  window.setTimeout(() => dragStore.set({ items }), 0);
  if (items.length > 1) {
    const badge = document.createElement('div');
    badge.className = 'drag-badge';
    badge.textContent = `${items.length} fields`;
    document.body.appendChild(badge);
    e.dataTransfer.setDragImage(badge, -10, -6);
    // the browser snapshots the element right away; remove it after this tick
    window.setTimeout(() => badge.remove(), 0);
  }
}

export function readFieldDrag(e: React.DragEvent | DragEvent): FieldDrag[] | null {
  const dt = e.dataTransfer;
  if (!dt) return null;
  const raw = dt.getData(FIELD_MIME);
  if (!raw) return hasFieldDrag(e) ? dragStore.get().items : null;
  try {
    const p = JSON.parse(raw) as { items?: FieldDrag[] };
    return Array.isArray(p.items) && p.items.length ? p.items : null;
  } catch {
    return null;
  }
}

export function hasFieldDrag(e: React.DragEvent | DragEvent): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(FIELD_MIME);
}
