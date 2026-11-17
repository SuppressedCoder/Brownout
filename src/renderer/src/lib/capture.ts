/** Copy a panel to the clipboard as a picture, or save it as a PNG. */
import { toast } from '../state/ui';
import { panelStore, PANEL_TITLES } from '../state/panels';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export async function capturePanel(id: string | undefined, mode: 'copy' | 'save'): Promise<boolean> {
  const el = id ? document.querySelector<HTMLElement>(`[data-panel="${CSS.escape(id)}"]`) : null;
  if (!id || !el) {
    toast('Click a panel first, then copy it as an image.');
    return false;
  }
  const title = PANEL_TITLES[panelStore.get().panels[id]?.type ?? 'graph'];
  const name = `brownout-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
  // hide hover-only controls while the picture is taken
  el.classList.add('capturing');
  await nextFrame();
  await nextFrame();
  try {
    const r = el.getBoundingClientRect();
    if (window.brownout?.capture) {
      const out = await window.brownout.capture({ x: r.left, y: r.top, width: r.width, height: r.height }, mode, name);
      if (mode === 'copy') toast(`Copied “${title}” as an image. Paste it into a chat or document.`);
      else if (out) toast(`Saved ${out}`);
      return !!out;
    }
    // Browser build: only canvas panels can be captured
    const canvas = el.querySelector('canvas');
    if (!canvas) {
      toast('In the browser build only graph and field panels can be copied as images.', 'error');
      return false;
    }
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) return false;
    if (mode === 'copy' && navigator.clipboard && 'write' in navigator.clipboard) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast(`Copied “${title}” as an image.`);
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    }
    return true;
  } catch (e) {
    toast(`Could not capture the panel: ${e instanceof Error ? e.message : e}`, 'error');
    return false;
  } finally {
    el.classList.remove('capturing');
  }
}
