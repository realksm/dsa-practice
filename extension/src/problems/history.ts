/**
 * Every Run Tests on a downloaded problem: when, which language, the verdict, how many cases
 * passed and how long the slowest case took. Kept in its own JSON file (not synced: it grows), keyed
 * like SolvedStore by repo + slug, newest first, at most MAX_RUNS per problem. No vscode import.
 */
import { promises as fs, readFileSync } from "fs";
import * as path from "path";
import type { CaseResult } from "../judge/judge";
import type { LanguageId } from "../judge/languages";
import type { StateStore } from "./solved";

export const HISTORY_KEY = "dsaDrill.history";
export const MAX_RUNS = 30;

/** AC, a failing verdict (the first failing case's), or CE for a compile error. */
export type RunVerdict = "AC" | "WA" | "TLE" | "MLE" | "RE" | "OLE" | "CE";

export interface RunRecord {
  /** ISO time. */
  at: string;
  language: LanguageId;
  verdict: RunVerdict;
  passed: number;
  total: number;
  /** Slowest case in ms (0 for a compile error). */
  maxTimeMs: number;
  /** Highest peak memory of any case, in MB (one decimal), when it was measured. */
  peakMb?: number;
  /** Test hash the run was against, if known. */
  hash?: string;
}

/** Summarise a finished, non-cancelled run. Undefined if it can't be judged (only cases without answers). */
export function summariseRun(
  cases: CaseResult[],
  total: number,
  compileError: boolean,
): Pick<RunRecord, "verdict" | "passed" | "total" | "maxTimeMs" | "peakMb"> | undefined {
  if (compileError) return { verdict: "CE", passed: 0, total, maxTimeMs: 0 };
  const failed = cases.find((c) => c.verdict !== "AC" && c.verdict !== "NO_EXPECTED");
  const passed = cases.filter((c) => c.verdict === "AC").length;
  if (!failed && (total === 0 || passed !== total)) return;
  const measured = cases.flatMap((c) => (c.memoryBytes !== undefined ? [c.memoryBytes] : []));
  const peak = measured.length ? Math.max(...measured) : undefined;
  return {
    verdict: failed ? (failed.verdict as RunVerdict) : "AC",
    passed,
    total,
    maxTimeMs: Math.round(Math.max(0, ...cases.map((c) => c.timeMs))),
    ...(peak !== undefined ? { peakMb: Math.round(peak / 104857.6) / 10 } : {}),
  };
}

const keyOf = (repo: string, slug: string) => `${repo}::${slug}`;

export class HistoryStore {
  private listeners = new Set<() => void>();

  constructor(private readonly state: StateStore) {}

  private all(): Record<string, RunRecord[]> {
    return this.state.get<Record<string, RunRecord[]>>(HISTORY_KEY, {});
  }

  /** Newest first. */
  runs(repo: string, slug: string): RunRecord[] {
    return this.all()[keyOf(repo, slug)] ?? [];
  }

  /** Every kept run, of every problem. */
  allRuns(): RunRecord[] {
    return Object.values(this.all()).flat();
  }

  async add(repo: string, slug: string, run: RunRecord): Promise<void> {
    const all = { ...this.all() };
    all[keyOf(repo, slug)] = [run, ...(all[keyOf(repo, slug)] ?? [])].slice(0, MAX_RUNS);
    await this.state.update(HISTORY_KEY, all);
    for (const fn of this.listeners) fn();
  }

  /** Fastest accepted run (by slowest case), preferring runs against the current tests. */
  best(repo: string, slug: string, currentHash?: string): RunRecord | undefined {
    const ac = this.runs(repo, slug).filter((r) => r.verdict === "AC");
    const current = currentHash ? ac.filter((r) => r.hash === currentHash) : [];
    const pool = current.length ? current : ac;
    return pool.reduce<RunRecord | undefined>((b, r) => (!b || r.maxTimeMs < b.maxTimeMs ? r : b), undefined);
  }

  onDidChange(fn: () => void): { dispose(): void } {
    this.listeners.add(fn);
    return { dispose: () => this.listeners.delete(fn) };
  }
}

export function describeRun(r: RunRecord): string {
  return r.verdict === "CE" ? "Compile error" : `${r.verdict} ${r.passed}/${r.total} · ${r.maxTimeMs} ms${r.peakMb !== undefined ? ` · ${r.peakMb} MB` : ""}`;
}

/**
 * A StateStore kept in one JSON file (the extension's global storage folder), so the history
 * doesn't share VS Code's globalState with the solved/filter keys and can't be lost to a write
 * race there. Read once; writes go out one at a time (write to a temp file, then rename).
 */
export class JsonFileStore {
  private data: Record<string, unknown> = {};
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {
    try {
      this.data = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      this.data = {};
    }
  }

  get<T>(key: string, defaultValue: T): T {
    return key in this.data ? (this.data[key] as T) : defaultValue;
  }

  update(key: string, value: unknown): Promise<void> {
    this.data = { ...this.data, [key]: JSON.parse(JSON.stringify(value)) };
    const text = JSON.stringify(this.data);
    this.writing = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, text);
      await fs.rename(tmp, this.file);
    }).catch((e) => console.error("DSA Drill: couldn't save", this.file, e));
    return this.writing;
  }
}
