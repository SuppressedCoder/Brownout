/**
 * The guide inside the app: docs/features.md, bundled with the build so it
 * works offline and always matches the version you run. Shown as the
 * Guide tab of the help sheet, with the sections listed on the left and a
 * search that keeps only the sections mentioning what you typed.
 *
 * The Markdown is read by core/markdown.ts into a tree and drawn as React
 * elements; no HTML from the file is ever used.
 *
 * Panels link to a section with openGuide('commands') (the section's
 * heading as a slug, see slugify).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import guideText from '@docs/features.md?raw';
import { parseMarkdown, parseInline, blockText, type Block } from '@core/markdown';
import { uiStore } from '../state/ui';
import { useStore } from '../state/store';
import { Icon } from './Icon';

/** The guide, split into its top-level sections (## headings), each with its blocks. */
interface Section {
  id: string;
  title: string;
  blocks: Block[];
  /** Lower-case text, for the search. */
  text: string;
  /** Headings inside it (###), for the contents list. */
  subs: { id: string; title: string }[];
}

let cached: { intro: Block[]; sections: Section[] } | null = null;

function guide(): { intro: Block[]; sections: Section[] } {
  if (cached) return cached;
  const blocks = parseMarkdown(guideText);
  const intro: Block[] = [];
  const sections: Section[] = [];
  for (const b of blocks) {
    if (b.k === 'h' && b.level === 2) sections.push({ id: b.id, title: b.text, blocks: [b], text: '', subs: [] });
    else if (sections.length) sections[sections.length - 1].blocks.push(b);
    else if (!(b.k === 'h' && b.level === 1)) intro.push(b);
  }
  for (const s of sections) {
    s.text = blockText(s.blocks).toLowerCase();
    s.subs = s.blocks.filter((b): b is Extract<Block, { k: 'h' }> => b.k === 'h' && b.level === 3).map((b) => ({ id: b.id, title: b.text }));
  }
  cached = { intro, sections };
  return cached;
}

/** Open the help sheet on the guide, at a section (its heading as a slug: 'commands', 'power', ...). */
export function openGuide(section?: string): void {
  uiStore.set((s) => ({ helpOpen: true, helpTab: 'guide', guideSection: section ?? null, guideEpoch: s.guideEpoch + 1 }));
}

/** A small link from a panel to its part of the guide. Placeholders let clicks through, so it opts back in. */
export function GuideLink({ section, children }: { section: string; children?: ReactNode }) {
  return (
    <button className="guide-link" onClick={() => openGuide(section)} data-testid="guide-link">
      <Icon name="help" size={12} /> {children ?? 'How to log this, in the guide'}
    </button>
  );
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((s, i) =>
        s.code ? (
          <code key={i}>{s.text}</code>
        ) : s.strong ? (
          <strong key={i}>{s.text}</strong>
        ) : s.em ? (
          <em key={i}>{s.text}</em>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.k) {
          case 'h': {
            const H = b.level <= 2 ? 'h2' : b.level === 3 ? 'h3' : 'h4';
            return (
              <H key={i} id={`guide-${b.id}`} data-guide-id={b.id}>
                <Inline text={b.text} />
              </H>
            );
          }
          case 'p':
            return (
              <p key={i}>
                <Inline text={b.text} />
              </p>
            );
          case 'code':
            return (
              <pre key={i} className="guide-code">
                <code>{b.text}</code>
              </pre>
            );
          case 'hr':
            return <hr key={i} />;
          case 'table':
            return (
              <table key={i} className="guide-table">
                <thead>
                  <tr>
                    {b.head.map((c, j) => (
                      <th key={j}>
                        <Inline text={c} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={j}>
                      {r.map((c, k) => (
                        <td key={k}>
                          <Inline text={c} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          case 'list': {
            const items = b.items.map((it, j) => (
              <li key={j}>
                {/* a list item that is one paragraph reads better without the paragraph's margins */}
                {it.length === 1 && it[0].k === 'p' ? <Inline text={it[0].text} /> : <Blocks blocks={it} />}
              </li>
            ));
            return b.ordered ? (
              <ol key={i} start={b.start}>
                {items}
              </ol>
            ) : (
              <ul key={i}>{items}</ul>
            );
          }
        }
      })}
    </>
  );
}

export function Guide() {
  const { intro, sections } = guide();
  const [q, setQ] = useState('');
  const want = useStore(uiStore, (s) => s.guideSection);
  const epoch = useStore(uiStore, (s) => s.guideEpoch);
  const bodyRef = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? sections.filter((s) => words.every((w) => s.text.includes(w))) : sections;
  }, [q, sections]);
  const go = (id: string) => {
    const el = bodyRef.current?.querySelector(`[data-guide-id="${id}"]`);
    el?.scrollIntoView({ block: 'start' });
  };
  // a panel's link asks for a section: clear the search so it is there, then go
  useEffect(() => {
    if (!want) return;
    setQ('');
    requestAnimationFrame(() => go(want));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want, epoch]);

  return (
    <div className="guide" data-testid="guide">
      <nav className="guide-toc scroll">
        <input className="search" placeholder="Search the guide…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="guide-search" />
        {shown.map((s) => (
          <div key={s.id}>
            <button className="guide-toc-item" onClick={() => go(s.id)}>
              {s.title}
            </button>
            {!q &&
              s.subs.map((h) => (
                <button key={h.id} className="guide-toc-item sub" onClick={() => go(h.id)}>
                  {h.title}
                </button>
              ))}
          </div>
        ))}
        {!shown.length && <div className="hint">Nothing in the guide mentions that.</div>}
      </nav>
      <div className="guide-body scroll" ref={bodyRef}>
        {!q && <Blocks blocks={intro} />}
        {shown.map((s) => (
          <section key={s.id}>
            <Blocks blocks={s.blocks} />
          </section>
        ))}
      </div>
    </div>
  );
}
