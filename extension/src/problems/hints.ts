/**
 * Hints: problems/<slug>/hints.md, one "## " heading per hint, shown one at a time.
 *
 *   ## Think about sums
 *   What do you need to remember about the numbers you've already seen?
 *
 *   ## A data structure
 *   A hash map from value to index answers "have I seen target - x?" in O(1).
 *
 * Anything before the first heading is ignored. hints.md isn't downloaded with the problem (no
 * spoiler on disk) and isn't part of the test hash; index.json only says how many hints there are.
 * Which hints the user has opened is kept in globalState under HINTS_KEY, per repo + slug.
 */
import type { StateStore } from "./solved";

export const HINTS_FILE = "hints.md";
export const HINTS_KEY = "dsaDrill.hints";

export interface Hint {
  title: string;
  body: string;
}

export function parseHints(text: string): Hint[] {
  const hints: Hint[] = [];
  let current: Hint | undefined;
  let inFence = false;
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = !inFence && line.match(/^##\s+(.*?)\s*#*\s*$/);
    if (h) {
      current = { title: h[1], body: "" };
      hints.push(current);
    } else if (current) current.body += line + "\n";
  }
  return hints.map((x) => ({ title: x.title, body: x.body.trim() }));
}

const keyOf = (repo: string, slug: string) => `${repo}::${slug}`;

/** How many hints of each problem the user has opened. */
export class HintStore {
  constructor(private readonly state: StateStore) {}

  private all(): Record<string, number> {
    return this.state.get<Record<string, number>>(HINTS_KEY, {});
  }

  shown(repo: string, slug: string): number {
    const n = this.all()[keyOf(repo, slug)];
    return typeof n === "number" && n > 0 ? Math.floor(n) : 0;
  }

  async setShown(repo: string, slug: string, n: number): Promise<void> {
    const all = { ...this.all() };
    if (n > 0) all[keyOf(repo, slug)] = n;
    else delete all[keyOf(repo, slug)];
    await this.state.update(HINTS_KEY, all);
  }
}

/** Starting point for hints.md (npm run new <slug> -- --hints). */
export const HINTS_TEMPLATE = `# Hints

Each "## " heading starts a hint. They are shown one at a time, in this order.

## A first nudge

TODO: what to look at first, without giving the idea away.

## The key idea

TODO: the observation the solution rests on.

## How to make it fast

TODO: the data structure or technique, and the complexity to aim for.
`;
