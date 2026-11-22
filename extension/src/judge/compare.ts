/**
 * Output comparison.
 *
 * Default mode compares whitespace-separated tokens:
 *   - integers are compared exactly (as big integers, so 10^18+1 != 10^18)
 *   - if either token is a decimal (has '.' or an exponent), both must be finite
 *     numbers within eps * max(1, |expected|)
 *   - everything else must match exactly (optionally ignoring case)
 *   - "nan" / "inf" only match the same text, never a number
 *
 * Exact mode compares line by line, ignoring trailing spaces and trailing blank lines.
 */

export interface CompareOptions {
  /** Compare line by line instead of token by token. */
  exact?: boolean;
  /** Treat YES and yes as equal. */
  ignoreCase?: boolean;
  /** Tolerance for decimal answers. Default 1e-6. */
  eps?: number;
}

export interface Difference {
  /** 1-based line number. */
  line: number;
  got: string;
  expected: string;
}

const INT = /^[+-]?\d+$/;
const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

export function tokensEqual(got: string, expected: string, ignoreCase = false, eps = 1e-6): boolean {
  if (ignoreCase) {
    got = got.toLowerCase();
    expected = expected.toLowerCase();
  }
  if (got === expected) return true;

  const gotInt = INT.test(got);
  const expInt = INT.test(expected);
  if (gotInt && expInt) return BigInt(got) === BigInt(expected);

  // Tolerance only applies when at least one side is written as a decimal.
  if (!NUM.test(got) || !NUM.test(expected)) return false;
  const x = Number(got);
  const y = Number(expected);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return Math.abs(x - y) <= eps * Math.max(1, Math.abs(y));
}

function tokens(s: string): string[] {
  const t = s.trim();
  return t === "" ? [] : t.split(/\s+/);
}

function lines(s: string): string[] {
  const ls = s.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trimEnd());
  while (ls.length > 0 && ls[ls.length - 1] === "") ls.pop();
  return ls;
}

function tokenListsEqual(a: string[], b: string[], o: CompareOptions): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!tokensEqual(a[i], b[i], o.ignoreCase, o.eps)) return false;
  }
  return true;
}

export function outputsMatch(got: string, expected: string, o: CompareOptions = {}): boolean {
  if (o.exact) {
    const g = lines(got);
    const e = lines(expected);
    return g.length === e.length && g.every((l, i) => l === e[i]);
  }
  return tokenListsEqual(tokens(got), tokens(expected), o);
}

/** First line where the outputs differ, or null if every line matches. */
export function firstDifference(got: string, expected: string, o: CompareOptions = {}): Difference | null {
  const g = lines(got);
  const e = lines(expected);
  for (let i = 0; i < Math.max(g.length, e.length); i++) {
    const gl = i < g.length ? g[i] : "<missing>";
    const el = i < e.length ? e[i] : "<missing>";
    const same = o.exact ? gl === el : tokenListsEqual(tokens(gl), tokens(el), o);
    if (i >= g.length || i >= e.length || !same) return { line: i + 1, got: gl, expected: el };
  }
  return null;
}
