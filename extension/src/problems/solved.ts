/**
 * Which problems the user has solved. A problem counts as solved once Run Tests passes every case.
 * Stored in the extension's global state (and synced with Settings Sync), keyed by repo + slug,
 * so it survives test updates, re-downloads and switching workspaces. No vscode import: unit-tested.
 */
import type { LanguageId } from "../judge/languages";

export const SOLVED_KEY = "dsaDrill.solved";

export interface SolvedRecord {
  /** Languages it was solved in, in the order they were first solved. */
  languages: LanguageId[];
  /** ISO date of the first solve. */
  firstAt: string;
  /** Test hash (from .source.json) of the last solve. Differs from the index after a test update. */
  hash?: string;
}

/** The part of vscode.Memento this needs. */
export interface StateStore {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
}

const keyOf = (repo: string, slug: string) => `${repo}::${slug}`;

export class SolvedStore {
  private listeners = new Set<() => void>();

  constructor(private readonly state: StateStore) {}

  private all(): Record<string, SolvedRecord> {
    return this.state.get<Record<string, SolvedRecord>>(SOLVED_KEY, {});
  }

  get(repo: string, slug: string): SolvedRecord | undefined {
    return this.all()[keyOf(repo, slug)];
  }

  isSolved(repo: string, slug: string): boolean {
    return !!this.get(repo, slug);
  }

  /** Record a solve. Returns true if the problem wasn't solved before (in any language). */
  async mark(repo: string, slug: string, language: LanguageId, hash?: string, now = new Date()): Promise<boolean> {
    const all = { ...this.all() };
    const old = all[keyOf(repo, slug)];
    all[keyOf(repo, slug)] = {
      languages: old ? (old.languages.includes(language) ? old.languages : [...old.languages, language]) : [language],
      firstAt: old?.firstAt ?? now.toISOString(),
      ...(hash ? { hash } : old?.hash ? { hash: old.hash } : {}),
    };
    await this.state.update(SOLVED_KEY, all);
    this.fire();
    return !old;
  }

  async unmark(repo: string, slug: string): Promise<void> {
    const all = { ...this.all() };
    if (!(keyOf(repo, slug) in all)) return;
    delete all[keyOf(repo, slug)];
    await this.state.update(SOLVED_KEY, all);
    this.fire();
  }

  onDidChange(fn: () => void): { dispose(): void } {
    this.listeners.add(fn);
    return { dispose: () => this.listeners.delete(fn) };
  }

  private fire() {
    for (const fn of this.listeners) fn();
  }
}
