/**
 * Finding a log's match video by file name.
 *
 * A log knows its match from the logged match info (FMS) or from its file
 * name ("FRC_20260321_143012_NYROC_Q12.wpilog"). A video usually names it
 * as "Q12", "qm12", "Qual 12", "2026nyroc_qm12" or "Match 12". The main
 * process lists the video files in folders the user chose; this ranks them.
 */

export type MatchKind = 'q' | 'e' | 'p';

export interface MatchKey {
  kind: MatchKind;
  number: number;
  /** Event code or name, when known ("NYROC"); a video that also names it ranks higher. */
  event?: string;
}

export interface VideoCandidate {
  name: string;
  path: string;
}

/** Words that name a match of each kind. "match" alone is weaker: it doesn't say which kind. */
const SPECIFIC: Record<MatchKind, string[]> = {
  q: ['q', 'qm', 'qual', 'quals', 'qualification', 'qualifications', 'qualifier'],
  e: ['e', 'em', 'elim', 'elims', 'elimination', 'eliminations', 'playoff', 'playoffs', 'final', 'finals'],
  p: ['p', 'pm', 'prac', 'practice'],
};
const GENERIC = ['match'];

/** The match a log is from, or null when neither its match info nor its file name says. */
export function logMatchKey(info: { matchType?: string; matchNumber?: number; eventName?: string }, fileName: string): MatchKey | null {
  let kind: MatchKind | null = null;
  let number = 0;
  let event = info.eventName?.trim() || undefined;
  const t = (info.matchType ?? '').toLowerCase();
  if (info.matchNumber && info.matchNumber > 0) {
    if (t.startsWith('qual')) kind = 'q';
    else if (t.startsWith('elim') || t.startsWith('playoff')) kind = 'e';
    else if (t.startsWith('prac')) kind = 'p';
    if (kind) number = info.matchNumber;
  }
  const m = /^(?:FRC|WPILIB|FIRST_DS)_\d{8}_\d{6}(?:_([A-Za-z0-9]+))?(?:_([A-Za-z]+\d+)(?:_\d+)?)?\.wpilog$/i.exec(fileName);
  if (m) {
    let code: string | undefined = m[1];
    let label: string | undefined = m[2];
    // "FRC_..._Q12.wpilog": the only part is the match, not an event
    if (!label && code && /^[A-Za-z]+\d+$/.test(code)) {
      label = code;
      code = undefined;
    }
    if (!event && code) event = code;
    const l = label ? /^([A-Za-z]+?)(\d+)$/.exec(label) : null;
    if (!kind && l) {
      const k = l[1][0].toLowerCase();
      if (k === 'q' || k === 'e' || k === 'p') {
        kind = k;
        number = Number(l[2]);
      }
    }
  }
  return kind && number > 0 ? { kind, number, event } : null;
}

function names(words: string[], n: number): RegExp {
  // a word, then optional separators, then the number with no digit after it; no letter right before the word
  return new RegExp(`(?:^|[^a-z])(?:${words.join('|')})[\\s_.#-]*0*${n}(?![0-9])`, 'i');
}

/** How well a video file name matches the log's match: 0 = not this match; higher is a better match. */
export function videoMatchScore(videoName: string, key: MatchKey): number {
  const base = videoName.replace(/\.[a-z0-9]+$/i, '');
  // a name that says another kind of match with this number is a different match
  for (const k of Object.keys(SPECIFIC) as MatchKind[]) if (k !== key.kind && names(SPECIFIC[k], key.number).test(base)) return 0;
  let score = names(SPECIFIC[key.kind], key.number).test(base) ? 3 : names(GENERIC, key.number).test(base) ? 1 : 0;
  if (score && key.event && key.event.length >= 3 && base.toLowerCase().includes(key.event.toLowerCase())) score += 1;
  return score;
}

/** The videos that name this match, best first. */
export function rankVideos(files: VideoCandidate[], key: MatchKey): VideoCandidate[] {
  return files
    .map((f) => ({ f, s: videoMatchScore(f.name, key) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.f.name.localeCompare(b.f.name))
    .map((x) => x.f);
}
