/** Drag-and-drop of one or many fields from the sidebar into panels. */
export const FIELD_MIME = 'application/x-brownout-field';

export interface FieldDrag {
  key: string;
  kind: string;
  structName?: string;
}

/** Start dragging fields. More than one shows a count badge next to the pointer. */
export function setFieldDrag(e: React.DragEvent, items: FieldDrag[]): void {
  e.dataTransfer.setData(FIELD_MIME, JSON.stringify({ items }));
  e.dataTransfer.setData('text/plain', items.map((d) => d.key).join('\n'));
  e.dataTransfer.effectAllowed = 'copy';
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
  if (!raw) return null;
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
