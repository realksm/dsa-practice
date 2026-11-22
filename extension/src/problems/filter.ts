/** The Problems sidebar filter: by tags and by solved state. No vscode import: unit-tested. */
import type { IndexEntry } from "./indexFile";

export const FILTER_KEY = "dsaDrill.filter";

export interface ProblemFilter {
  /** Show problems that have at least one of these tags. Empty = any tags. */
  tags: string[];
  hideSolved: boolean;
}

export const NO_FILTER: ProblemFilter = { tags: [], hideSolved: false };

/** Accepts whatever was stored (possibly by an older version) and returns a valid filter. */
export function normaliseFilter(value: unknown): ProblemFilter {
  const v = (value ?? {}) as Partial<ProblemFilter>;
  const tags = Array.isArray(v.tags) ? [...new Set(v.tags.filter((t): t is string => typeof t === "string"))].sort() : [];
  return { tags, hideSolved: v.hideSolved === true };
}

export const isFilterActive = (f: ProblemFilter) => f.tags.length > 0 || f.hideSolved;

export function applyFilter(entries: IndexEntry[], f: ProblemFilter, isSolved: (slug: string) => boolean): IndexEntry[] {
  return entries.filter(
    (e) => (!f.hideSolved || !isSolved(e.slug)) && (!f.tags.length || (e.tags ?? []).some((t) => f.tags.includes(t))),
  );
}

/** Every tag in the index with how many problems have it, most common first. */
export function tagCounts(entries: IndexEntry[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of entries) for (const t of new Set(e.tags ?? [])) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** One line for the top of the sidebar, e.g. "Tagged arrays or hashing · solved hidden". */
export function describeFilter(f: ProblemFilter): string | undefined {
  if (!isFilterActive(f)) return undefined;
  const parts: string[] = [];
  if (f.tags.length) parts.push(`Tagged ${f.tags.join(" or ")}`);
  if (f.hideSolved) parts.push(parts.length ? "solved hidden" : "Solved problems hidden");
  return parts.join(" · ");
}
