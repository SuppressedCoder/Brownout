/**
 * A small Markdown reader for the in-app guide (docs/features.md, bundled
 * with the app). It covers what the guide uses: headings, paragraphs,
 * bullet and numbered lists (nested by indentation), fenced code blocks
 * (also inside list items), tables, horizontal rules, and inline code,
 * bold, italic and links. The result is a tree the renderer turns into
 * React elements: no HTML is ever produced, so nothing in the text can run.
 */

export type Block =
  | { k: 'h'; level: number; text: string; id: string }
  | { k: 'p'; text: string }
  | { k: 'code'; lang: string; text: string }
  | { k: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { k: 'table'; head: string[]; rows: string[][] }
  | { k: 'hr' };

export interface Span {
  text: string;
  code?: boolean;
  strong?: boolean;
  em?: boolean;
}

/** "2.7 See what the robot code was doing" -> "2-7-see-what-the-robot-code-was-doing". */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const indentOf = (l: string) => l.length - l.trimStart().length;
const LIST = /^([-*]|\d+\.)\s+(.*)$/;
const FENCE = /^```/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const HR = /^(-{3,}|\*{3,})$/;
const TABLE_SEP = /^\|?\s*:?-{3,}/;

/** Does this line start a block other than a paragraph? */
function startsBlock(lines: string[], i: number): boolean {
  const t = lines[i].trim();
  return FENCE.test(t) || HEADING.test(t) || HR.test(t) || LIST.test(t) || (t.startsWith('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1].trim()));
}

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function parseLines(lines: string[], ids: Map<string, number>): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) {
      i++;
      continue;
    }
    const ind = indentOf(line);
    if (FENCE.test(t)) {
      const lang = t.slice(3).trim();
      let j = i + 1;
      while (j < lines.length && !FENCE.test(lines[j].trim())) j++;
      const body = lines.slice(i + 1, j).map((l) => l.slice(Math.min(ind, indentOf(l))));
      out.push({ k: 'code', lang, text: body.join('\n') });
      i = j + 1;
      continue;
    }
    const h = HEADING.exec(t);
    if (h) {
      const base = slugify(h[2]) || 'section';
      const n = ids.get(base) ?? 0;
      ids.set(base, n + 1);
      out.push({ k: 'h', level: h[1].length, text: h[2], id: n ? `${base}-${n + 1}` : base });
      i++;
      continue;
    }
    if (HR.test(t)) {
      out.push({ k: 'hr' });
      i++;
      continue;
    }
    if (t.startsWith('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1].trim())) {
      const head = cells(t);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      out.push({ k: 'table', head, rows });
      continue;
    }
    const m = LIST.exec(t);
    if (m) {
      const ordered = /\d/.test(m[1]);
      const items: string[][] = [];
      let contentIndent = 0;
      while (i < lines.length) {
        const l = lines[i];
        const lt = l.trim();
        if (!lt) {
          // a blank line continues the list only if more of it follows
          let k = i + 1;
          while (k < lines.length && !lines[k].trim()) k++;
          if (k < lines.length && (indentOf(lines[k]) > ind || (indentOf(lines[k]) === ind && LIST.exec(lines[k].trim())))) {
            if (items.length) items[items.length - 1].push('');
            i++;
            continue;
          }
          break;
        }
        const li = indentOf(l);
        const lm = LIST.exec(lt);
        if (li === ind && lm && /\d/.test(lm[1]) === ordered) {
          items.push([lm[2]]);
          contentIndent = ind + lm[1].length + 1;
          i++;
        } else if (li > ind && items.length) {
          items[items.length - 1].push(l.slice(Math.min(li, contentIndent)));
          i++;
        } else if (li >= ind && items.length && !startsBlock(lines, i)) {
          // a lazy continuation of the item's text
          items[items.length - 1].push(lt);
          i++;
        } else break;
      }
      out.push({ k: 'list', ordered, start: ordered ? parseInt(m[1], 10) : 1, items: items.map((it) => parseLines(it, ids)) });
      continue;
    }
    // a paragraph: lines up to a blank line or the start of another block
    const para: string[] = [t];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) para.push(lines[i++].trim());
    out.push({ k: 'p', text: para.join(' ') });
  }
  return out;
}

export function parseMarkdown(src: string): Block[] {
  return parseLines(src.replace(/\r\n?/g, '\n').split('\n'), new Map());
}

/** Inline formatting: `code`, **bold**, *italic*, and [text](link) shown as its text. Bold and italic may wrap code. */
export function parseInline(src: string): Span[] {
  // code first, as placeholders, so a `*` inside code is never formatting and emphasis can wrap code
  const codes: string[] = [];
  const text = src.replace(/`([^`]+)`/g, (_m, c: string) => `${codes.push(c) - 1}`);
  const out: Span[] = [];
  const emit = (t: string, style: { strong?: boolean; em?: boolean }) => {
    const parts = t.split(/(\d+)/);
    parts.forEach((part, i) => {
      if (i % 2 === 1) out.push({ text: codes[Number(part)], code: true });
      else if (part) out.push({ text: part, ...style });
    });
  };
  const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) emit(text.slice(last, m.index), {});
    if (m[1] !== undefined) emit(m[1], { strong: true });
    else if (m[2] !== undefined) emit(m[2], { em: true });
    else emit(m[3], {});
    last = m.index + m[0].length;
  }
  if (last < text.length) emit(text.slice(last), {});
  return out;
}

/** All the text of some blocks, for searching. */
export function blockText(blocks: Block[]): string {
  let s = '';
  for (const b of blocks) {
    if (b.k === 'h' || b.k === 'p' || b.k === 'code') s += ` ${b.text}`;
    else if (b.k === 'list') for (const it of b.items) s += blockText(it);
    else if (b.k === 'table') s += ` ${b.head.join(' ')} ${b.rows.map((r) => r.join(' ')).join(' ')}`;
  }
  return s;
}
