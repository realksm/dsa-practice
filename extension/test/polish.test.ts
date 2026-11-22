import * as assert from "node:assert/strict";
import { test } from "node:test";
import { applyFilter, describeFilter, isFilterActive, NO_FILTER, normaliseFilter, tagCounts } from "../src/problems/filter";
import type { IndexEntry } from "../src/problems/indexFile";
import { SOLVED_KEY, SolvedStore } from "../src/problems/solved";
import { memento } from "./helpers";

const entry = (slug: string, tags?: string[]): IndexEntry => ({ slug, title: slug, files: [], hash: "h", ...(tags ? { tags } : {}) });
const entries = [entry("two-sum", ["arrays", "hashing"]), entry("max-subarray", ["arrays", "dp"]), entry("untagged")];

test("filter: no filter shows everything", () => {
  assert.deepEqual(applyFilter(entries, NO_FILTER, () => false).map((e) => e.slug), ["two-sum", "max-subarray", "untagged"]);
  assert.equal(isFilterActive(NO_FILTER), false);
  assert.equal(describeFilter(NO_FILTER), undefined);
});

test("filter: a problem shows if it has any checked tag", () => {
  const f = { tags: ["hashing", "dp"], hideSolved: false };
  assert.deepEqual(applyFilter(entries, f, () => false).map((e) => e.slug), ["two-sum", "max-subarray"]);
  assert.deepEqual(applyFilter(entries, { tags: ["dp"], hideSolved: false }, () => false).map((e) => e.slug), ["max-subarray"]);
  assert.equal(describeFilter(f), "Tagged hashing or dp");
});

test("filter: hide solved, alone and with tags", () => {
  const solved = (s: string) => s === "two-sum";
  assert.deepEqual(applyFilter(entries, { tags: [], hideSolved: true }, solved).map((e) => e.slug), ["max-subarray", "untagged"]);
  assert.deepEqual(applyFilter(entries, { tags: ["hashing"], hideSolved: true }, solved), []);
  assert.equal(describeFilter({ tags: [], hideSolved: true }), "Solved problems hidden");
  assert.equal(describeFilter({ tags: ["arrays"], hideSolved: true }), "Tagged arrays · solved hidden");
});

test("filter: stored values are cleaned up", () => {
  assert.deepEqual(normaliseFilter(undefined), NO_FILTER);
  assert.deepEqual(normaliseFilter({ tags: ["b", "a", "b", 3], hideSolved: "yes" }), { tags: ["a", "b"], hideSolved: false });
});

test("tag counts: most common first, then by name", () => {
  assert.deepEqual(tagCounts([...entries, entry("dup", ["dp", "dp"])]), [
    { tag: "arrays", count: 2 },
    { tag: "dp", count: 2 },
    { tag: "hashing", count: 1 },
  ]);
});

test("solved: mark, languages, first date kept, per repo", async () => {
  const m = memento();
  const s = new SolvedStore(m);
  let changes = 0;
  s.onDidChange(() => changes++);

  assert.equal(s.isSolved("me/repo", "two-sum"), false);
  assert.equal(await s.mark("me/repo", "two-sum", "cpp", "h1", new Date("2026-11-01T10:00:00Z")), true, "first solve");
  assert.equal(await s.mark("me/repo", "two-sum", "python", "h2", new Date("2026-11-05T10:00:00Z")), false, "already solved");
  assert.equal(await s.mark("me/repo", "two-sum", "cpp", undefined), false);
  assert.deepEqual(s.get("me/repo", "two-sum"), { languages: ["cpp", "python"], firstAt: "2026-11-01T10:00:00.000Z", hash: "h2" });
  assert.equal(s.isSolved("other/repo", "two-sum"), false, "keyed by repo");
  assert.equal(changes, 3);
  assert.ok(SOLVED_KEY in m.data);
});

test("solved: unmark", async () => {
  const s = new SolvedStore(memento());
  await s.mark("r", "a", "java");
  await s.mark("r", "b", "java");
  await s.unmark("r", "a");
  await s.unmark("r", "missing");
  assert.equal(s.isSolved("r", "a"), false);
  assert.equal(s.isSolved("r", "b"), true);
});
