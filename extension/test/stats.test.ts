// Phase 7: practice stats (solved counts, streak, activity) and the stats page's markup.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { RunRecord } from "../src/problems/history";
import { IndexEntry } from "../src/problems/indexFile";
import { SolvedRecord } from "../src/problems/solved";
import { ACTIVITY_KEY, ActivityStore, computeStats, dayKey, streakOf } from "../src/problems/stats";
import { memento } from "./helpers";

const entry = (slug: string, difficulty?: string, tags?: string[]): IndexEntry => ({ slug, title: slug, difficulty, tags, files: [], hash: "h" });
const day = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 15, 0);
};

test("dayKey uses the local date", () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assert.equal(dayKey(new Date(2026, 11, 31, 0, 1)), "2026-12-31");
});

test("streak: today counts, a gap ends it, yesterday keeps it alive", () => {
  const a = (ks: string[]) => Object.fromEntries(ks.map((k) => [k, { runs: 1, accepted: 0 }]));
  assert.deepEqual(streakOf(a(["2026-11-20", "2026-11-21", "2026-11-22"]), day("2026-11-22")), { current: 3, longest: 3, activeToday: true });
  assert.deepEqual(streakOf(a(["2026-11-20", "2026-11-21"]), day("2026-11-22")), { current: 2, longest: 2, activeToday: false }, "not yet today");
  assert.deepEqual(streakOf(a(["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-20"]), day("2026-11-22")), { current: 0, longest: 3, activeToday: false });
  assert.deepEqual(streakOf(a(["2026-02-28", "2026-03-01"]), day("2026-03-01")), { current: 2, longest: 2, activeToday: true }, "across a month end");
  assert.deepEqual(streakOf({ "2026-11-22": { runs: 0, accepted: 0 } }, day("2026-11-22")).current, 0, "a day with 0 runs isn't active");
});

test("ActivityStore counts runs per day and seeds itself from the history once", async () => {
  const state = memento();
  const runs: RunRecord[] = [
    { at: day("2026-11-20").toISOString(), language: "cpp", verdict: "WA", passed: 0, total: 1, maxTimeMs: 1 },
    { at: day("2026-11-20").toISOString(), language: "cpp", verdict: "AC", passed: 1, total: 1, maxTimeMs: 1 },
  ];
  const store = new ActivityStore(state, () => runs);
  await Promise.resolve();
  assert.deepEqual(store.days(), { "2026-11-20": { runs: 2, accepted: 1 } });
  await store.record(true, day("2026-11-20"));
  await store.record(false, day("2026-11-21"));
  assert.deepEqual(store.days(), { "2026-11-20": { runs: 3, accepted: 2 }, "2026-11-21": { runs: 1, accepted: 0 } });
  // a second start doesn't seed again
  new ActivityStore(state, () => runs);
  await Promise.resolve();
  assert.equal((state.data[ACTIVITY_KEY] as Record<string, { runs: number }>)["2026-11-20"].runs, 3);
});

test("computeStats: per difficulty, tag and language, plus a year of days", () => {
  const problems = [entry("a", "easy", ["arrays", "hashing"]), entry("b", "easy", ["arrays"]), entry("c", "hard", ["graphs"]), entry("d")];
  const solved: Record<string, SolvedRecord> = {
    a: { languages: ["cpp", "python"], firstAt: day("2026-11-21").toISOString() },
    c: { languages: ["cpp"], firstAt: day("2026-11-22").toISOString() },
  };
  const activity = { "2026-11-21": { runs: 4, accepted: 1 }, "2026-11-22": { runs: 2, accepted: 1 }, "2020-01-01": { runs: 9, accepted: 9 } };
  const s = computeStats(problems, (slug) => solved[slug], activity, day("2026-11-22"));

  assert.equal(s.solved, 2);
  assert.equal(s.total, 4);
  assert.deepEqual(s.byDifficulty, [
    { name: "Easy", solved: 1, total: 2 },
    { name: "Hard", solved: 1, total: 1 },
    { name: "Unrated", solved: 0, total: 1 },
  ]);
  assert.deepEqual(s.byTag, [
    { name: "arrays", solved: 1, total: 2 },
    { name: "graphs", solved: 1, total: 1 },
    { name: "hashing", solved: 1, total: 1 },
  ]);
  assert.deepEqual(s.byLanguage, [
    { name: "C++", solved: 2 },
    { name: "Python", solved: 1 },
  ]);
  assert.deepEqual(s.streak, { current: 2, longest: 2, activeToday: true }, "2020 is outside the grid but still a (shorter) run of days");

  // 2026-11-22 is a Sunday: 53 whole weeks, Monday first, ending today
  assert.equal(s.days.length, 53 * 7);
  assert.equal(day(s.days[0].date).getDay(), 1, "starts on a Monday");
  assert.equal(s.days.at(-1)!.date, "2026-11-22");
  assert.deepEqual(s.days.at(-1), { date: "2026-11-22", runs: 2, accepted: 1, solved: 1 });
  assert.equal(s.activeDays, 2);
  assert.equal(s.runs, 6, "only runs inside the grid");

  // midweek: the current week is cut at today
  const wed = computeStats(problems, () => undefined, {}, day("2026-11-18"), 2);
  assert.equal(wed.days.length, 7 + 3);
});
