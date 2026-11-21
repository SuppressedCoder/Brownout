/**
 * Field keys grouped by folder, for lists that show a folder once above the
 * fields in it (the field search, field boxes' lists, In panels).
 */

/** A key split for showing: the folder (dimmed) and the name. */
export function splitKey(key: string): { folder: string; leaf: string } {
  const i = key.lastIndexOf('/', key.length - 2);
  return { folder: key.slice(0, i + 1), leaf: key.slice(i + 1) };
}

/** "/A/B/C/" -> ["/A/", "/A/B/"]: the folders above, top first, leaving out ones with no name ("/"). */
function foldersAbove(folder: string): string[] {
  const out: string[] = [];
  for (let i = folder.indexOf('/'); i >= 0 && i < folder.length - 1; i = folder.indexOf('/', i + 1)) {
    const p = folder.slice(0, i + 1);
    if (p.split('/').some(Boolean)) out.push(p);
  }
  return out;
}

/** Sibling folders merge into one list under their parent only while it stays this short. */
export const FOLDER_MERGE_MAX = 16;

export interface FolderGroup<F> {
  /** The whole folder ("/RealOutputs/Drive/"); show `folder.slice(parent.folder.length)` inside a parent. */
  folder: string;
  /** Fields in it, named by `key.slice(folder.length)`; may hold a sub-folder ("Module0/Speed"). */
  fields: F[];
  /** Folders inside it with their own box. */
  groups: FolderGroup<F>[];
}

/**
 * Keys in groups by the folder they are in, so no folder is shown twice:
 * - fields in the same folder share a group;
 * - groups in sibling folders (Module0/, Module1/, ...) merge into one list
 *   under the folder they share while it stays short (FOLDER_MERGE_MAX);
 * - what is left nests: a folder holding other groups, or shared by several,
 *   is a group around them, and each inner group is named from there.
 * Groups keep the order their first field came in; inside a group fields are
 * in natural order (0, 1, 2 ... 10), or in the order they came with sort: false.
 */
export function groupByFolder<F extends { key: string }>(list: F[], opts: { sort?: boolean } = {}): FolderGroup<F>[] {
  type Item = { f: F; i: number };
  let groups = new Map<string, Item[]>();
  list.forEach((f, i) => {
    const folder = f.key.slice(0, f.key.lastIndexOf('/') + 1);
    const g = groups.get(folder);
    if (g) g.push({ f, i });
    else groups.set(folder, [{ f, i }]);
  });

  // 1. short siblings become one list under their parent, deepest first, until nothing changes
  for (;;) {
    const kids = new Map<string, string[]>();
    for (const folder of groups.keys()) {
      const p = foldersAbove(folder).pop();
      if (!p) continue;
      const k = kids.get(p);
      if (k) k.push(folder);
      else kids.set(p, [folder]);
    }
    let merged = false;
    for (const [p, folders] of [...kids].sort((a, b) => b[0].length - a[0].length)) {
      const members = groups.has(p) ? [p, ...folders] : folders;
      if (members.length < 2) continue;
      const total = members.reduce((n, m) => n + groups.get(m)!.length, 0);
      if (total > FOLDER_MERGE_MAX) continue;
      const set = new Set(members);
      const next = new Map<string, Item[]>();
      for (const [folder, g] of groups) {
        if (!set.has(folder)) next.set(folder, g);
        else if (!next.has(p)) next.set(p, members.flatMap((m) => groups.get(m)!));
      }
      groups = next;
      merged = true;
      break;
    }
    if (!merged) break;
  }

  // 2. nest: a box for every group folder and every folder where two or more of them branch off
  const branches = new Map<string, Set<string>>();
  for (const folder of groups.keys()) {
    const path = [...foldersAbove(folder), folder];
    for (let j = 0; j < path.length - 1; j++) {
      const b = branches.get(path[j]) ?? new Set<string>();
      b.add(path[j + 1]);
      branches.set(path[j], b);
    }
  }
  const boxes = new Set(groups.keys());
  for (const [p, b] of branches) if (b.size >= 2) boxes.add(p);

  const natural = (a: Item, b: Item) => a.f.key.localeCompare(b.f.key, undefined, { numeric: true });
  const inOrder = (a: Item, b: Item) => a.i - b.i;
  type Box = { folder: string; items: Item[]; kids: Box[]; first: number };
  const made = new Map<string, Box>();
  for (const folder of boxes) {
    const items = (groups.get(folder) ?? []).sort(opts.sort === false ? inOrder : natural);
    made.set(folder, { folder, items, kids: [], first: Math.min(Infinity, ...items.map((x) => x.i)) });
  }
  const top: Box[] = [];
  // deepest first, so a box knows its first field before its parent is placed
  for (const box of [...made.values()].sort((a, b) => b.folder.length - a.folder.length)) {
    const parent = foldersAbove(box.folder)
      .reverse()
      .find((p) => made.has(p));
    if (parent) {
      const pb = made.get(parent)!;
      pb.kids.push(box);
      pb.first = Math.min(pb.first, box.first);
    } else top.push(box);
  }
  const out = (b: Box): FolderGroup<F> => ({
    folder: b.folder,
    fields: b.items.map((x) => x.f),
    groups: b.kids.sort((x, y) => x.first - y.first).map(out),
  });
  return top.sort((x, y) => x.first - y.first).map(out);
}

/** Every field of the groups in the order they are shown: a group's own fields, then its inner groups. */
export function groupFields<F>(groups: FolderGroup<F>[]): F[] {
  return groups.flatMap((g) => [...g.fields, ...groupFields(g.groups)]);
}
