/**
 * Practice stats: solved counts per difficulty / tag / language, the daily streak and a year of
 * activity. Activity is a count of Run Tests per local day (all repos), kept in the history file
 * under ACTIVITY_KEY; unlike the history it isn't capped per problem, so the streak survives.
 * No vscode import: unit-tested.
 */
import { LanguageId, LANGUAGES } from "../judge/languages";
import type { RunRecord } from "./history";
import type { IndexEntry } from "./indexFile";
import type { SolvedRecord, StateStore } from "./solved";

export const ACTIVITY_KEY = "dsaDrill.activity";

export interface DayActivity {
  /** Run Tests on that day. */
  runs: number;
  /** Of those, how many passed every case. */
  accepted: number;
}

/** "2026-11-22" in local time: a day starts at the user's midnight, not UTC's. */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

export class ActivityStore {
  constructor(
    private readonly state: StateStore,
    /** Runs already in the history, counted once when there is no activity yet (upgrading from 0.2). */
    seed?: () => RunRecord[],
  ) {
    if (seed && this.state.get(ACTIVITY_KEY, undefined) === undefined) {
      const days: Record<string, DayActivity> = {};
      for (const r of seed()) {
        const k = dayKey(new Date(r.at));
        const d = (days[k] ??= { runs: 0, accepted: 0 });
        d.runs++;
        if (r.verdict === "AC") d.accepted++;
      }
      void this.state.update(ACTIVITY_KEY, days);
    }
  }

  days(): Record<string, DayActivity> {
    return this.state.get<Record<string, DayActivity>>(ACTIVITY_KEY, {});
  }

  async record(accepted: boolean, at = new Date()): Promise<void> {
    const all = { ...this.days() };
    const k = dayKey(at);
    const old = all[k] ?? { runs: 0, accepted: 0 };
    all[k] = { runs: old.runs + 1, accepted: old.accepted + (accepted ? 1 : 0) };
    await this.state.update(ACTIVITY_KEY, all);
  }
}

export interface Ratio {
  name: string;
  solved: number;
  total: number;
}

export interface Streak {
  /** Days in a row with at least one run, ending today (or yesterday, if today has none yet). */
  current: number;
  longest: number;
  activeToday: boolean;
}

export interface Stats {
  solved: number;
  total: number;
  byDifficulty: Ratio[];
  /** Most problems first. */
  byTag: Ratio[];
  /** Problems solved in each language (a problem solved in two counts in both). */
  byLanguage: { name: string; solved: number }[];
  streak: Streak;
  /** Whole weeks (Monday first) ending with this week: one entry per day, future days left out. */
  days: { date: string; runs: number; accepted: number; solved: number }[];
  /** Days in `days` with a run. */
  activeDays: number;
  runs: number;
}

const DIFFICULTIES = ["easy", "medium", "hard"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function streakOf(activity: Record<string, DayActivity>, today: Date): Streak {
  const active = (d: Date) => (activity[dayKey(d)]?.runs ?? 0) > 0;
  const activeToday = active(today);
  let current = 0;
  for (let d = activeToday ? today : addDays(today, -1); active(d); d = addDays(d, -1)) current++;
  const keys = Object.keys(activity).filter((k) => activity[k].runs > 0).sort();
  let longest = 0;
  let run = 0;
  let prev: Date | undefined;
  for (const k of keys) {
    const [y, m, dd] = k.split("-").map(Number);
    const d = new Date(y, m - 1, dd);
    run = prev && dayKey(addDays(prev, 1)) === k ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  return { current, longest: Math.max(longest, current), activeToday };
}

export function computeStats(
  problems: IndexEntry[],
  solvedOf: (slug: string) => SolvedRecord | undefined,
  activity: Record<string, DayActivity>,
  today = new Date(),
  weeks = 53,
): Stats {
  const isSolved = (p: IndexEntry) => !!solvedOf(p.slug);
  const ratio = (name: string, list: IndexEntry[]): Ratio => ({ name, solved: list.filter(isSolved).length, total: list.length });

  const groups = new Map<string, IndexEntry[]>();
  for (const p of problems) {
    const d = p.difficulty || "unrated";
    groups.set(d, [...(groups.get(d) ?? []), p]);
  }
  const rank = (d: string) => (DIFFICULTIES.includes(d) ? DIFFICULTIES.indexOf(d) : d === "unrated" ? 99 : 50);
  const byDifficulty = [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)).map(([d, l]) => ratio(cap(d), l));

  const tags = new Map<string, IndexEntry[]>();
  for (const p of problems) for (const t of p.tags ?? []) tags.set(t, [...(tags.get(t) ?? []), p]);
  const byTag = [...tags.entries()].map(([t, l]) => ratio(t, l)).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const langCount = new Map<LanguageId, number>();
  const solvedOnDay = new Map<string, number>();
  for (const p of problems) {
    const s = solvedOf(p.slug);
    if (!s) continue;
    for (const l of s.languages) langCount.set(l, (langCount.get(l) ?? 0) + 1);
    const k = dayKey(new Date(s.firstAt));
    solvedOnDay.set(k, (solvedOnDay.get(k) ?? 0) + 1);
  }
  const byLanguage = (Object.keys(LANGUAGES) as LanguageId[])
    .filter((l) => langCount.has(l))
    .map((l) => ({ name: LANGUAGES[l].name, solved: langCount.get(l)! }));

  // start on the Monday `weeks - 1` weeks before this week's Monday
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  const start = addDays(monday, -7 * (weeks - 1));
  const days: Stats["days"] = [];
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const k = dayKey(d);
    days.push({ date: k, runs: activity[k]?.runs ?? 0, accepted: activity[k]?.accepted ?? 0, solved: solvedOnDay.get(k) ?? 0 });
  }

  return {
    solved: problems.filter(isSolved).length,
    total: problems.length,
    byDifficulty,
    byTag,
    byLanguage,
    streak: streakOf(activity, today),
    days,
    activeDays: days.filter((d) => d.runs > 0).length,
    runs: days.reduce((n, d) => n + d.runs, 0),
  };
}
