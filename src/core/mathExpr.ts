/**
 * Math in number boxes: "0.09448 * 360", "(27 + 3) / 39.37", "2^12", "sqrt(2) / 2".
 *
 * A small recursive-descent reader; nothing is ever passed to eval. It knows:
 * - numbers: 12, 0.5, .5, 1e-3;
 * - + - * / (also × and ÷), % (remainder), ^ or ** (power, right to left),
 *   parentheses, a leading minus or plus;
 * - pi and tau;
 * - sqrt, abs, sin, cos, tan, asin, acos, atan (radians), round, floor, ceil,
 *   and min, max, hypot, atan2 with commas between their arguments.
 *
 * Returns null for anything else, and for a result that is not a finite number.
 */

const FUNCTIONS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  min: Math.min,
  max: Math.max,
  hypot: Math.hypot,
  atan2: Math.atan2,
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, tau: 2 * Math.PI };

type Token = { k: 'num'; v: number } | { k: 'name'; v: string } | { k: 'op'; v: string };

function tokenize(src: string): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) {
      out.push({ k: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const name = /^[a-z_][a-z0-9_]*/i.exec(src.slice(i));
    if (name) {
      out.push({ k: 'name', v: name[0].toLowerCase() });
      i += name[0].length;
      continue;
    }
    if (src.startsWith('**', i)) {
      out.push({ k: 'op', v: '^' });
      i += 2;
      continue;
    }
    const op = c === '×' ? '*' : c === '÷' ? '/' : c;
    if ('+-*/%^(),'.includes(op)) {
      out.push({ k: 'op', v: op });
      i++;
      continue;
    }
    return null;
  }
  return out;
}

/** The number a typed text works out to, or null when it is not one. */
export function evalNumber(text: string): number | null {
  const src = text.trim();
  if (src === '') return null;
  // the common case: a plain number
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(src)) {
    const v = Number(src);
    return Number.isFinite(v) ? v : null;
  }
  const tokens = tokenize(src);
  if (!tokens) return null;
  let p = 0;
  const peek = (v: string) => tokens[p]?.k === 'op' && tokens[p].v === v;
  const fail = (): never => {
    throw new Error('not a number');
  };
  const expect = (v: string) => (peek(v) ? p++ : fail());

  // sum := product (('+' | '-') product)*
  const sum = (): number => {
    let v = product();
    while (peek('+') || peek('-')) v = tokens[p++].v === '+' ? v + product() : v - product();
    return v;
  };
  // product := unary (('*' | '/' | '%') unary)*
  const product = (): number => {
    let v = unary();
    while (peek('*') || peek('/') || peek('%')) {
      const op = tokens[p++].v;
      const r = unary();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  };
  // unary := ('-' | '+') unary | power   (so -2^2 is -4)
  const unary = (): number => {
    if (peek('-')) return (p++, -unary());
    if (peek('+')) return (p++, unary());
    return power();
  };
  // power := atom ('^' unary)?   (right to left: 2^3^2 is 2^9)
  const power = (): number => {
    const base = atom();
    if (peek('^')) {
      p++;
      return Math.pow(base, unary());
    }
    return base;
  };
  const atom = (): number => {
    const t = tokens[p++];
    if (!t) return fail();
    if (t.k === 'num') return t.v;
    if (t.k === 'op' && t.v === '(') {
      const v = sum();
      expect(')');
      return v;
    }
    if (t.k === 'name') {
      if (t.v in CONSTANTS) return CONSTANTS[t.v];
      const fn = FUNCTIONS[t.v];
      if (!fn) return fail();
      expect('(');
      const args = [sum()];
      while (peek(',')) {
        p++;
        args.push(sum());
      }
      expect(')');
      return fn(...args);
    }
    return fail();
  };

  try {
    const v = sum();
    if (p !== tokens.length) return null;
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
