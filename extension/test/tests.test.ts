import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as path from "path";
import { loadDataDir, loadMeta } from "../src/judge/tests";
import { languageOf } from "../src/judge/languages";
import { describeExit } from "../src/judge/runner";
import { makeProblem } from "./helpers";

test("loads .in/.out pairs in natural order, .ans works, missing output is null", async () => {
  const dir = makeProblem({
    ".data/10.in": "ten",
    ".data/10.out": "10",
    ".data/2.in": "two",
    ".data/2.ans": "2",
    ".data/1.in": "one",
    ".data/notes.txt": "ignored",
  });
  const cases = await loadDataDir(path.join(dir, ".data"));
  assert.deepEqual(cases.map((c) => c.name), ["1", "2", "10"]);
  assert.equal(cases[0].expected, null);
  assert.equal(cases[1].expected, "2");
  assert.equal(cases[2].input, "ten");
});

test("missing .data folder gives a clear error", async () => {
  const dir = makeProblem({ "problem.md": "x" });
  await assert.rejects(loadDataDir(path.join(dir, ".data")), /No \.data folder/);
});

test("meta.json is optional, but must be valid when present", async () => {
  assert.deepEqual(await loadMeta(makeProblem({})), {});
  assert.equal((await loadMeta(makeProblem({ "meta.json": '{"timeLimit": 3}' }))).timeLimit, 3);
  await assert.rejects(loadMeta(makeProblem({ "meta.json": "{oops" })), /not valid JSON/);
});

test("language detection", () => {
  assert.equal(languageOf("a/solution.cpp"), "cpp");
  assert.equal(languageOf("Main.JAVA"), "java");
  assert.equal(languageOf("x.py"), "python");
  assert.equal(languageOf("x.rs"), undefined);
});

test("exit descriptions", () => {
  assert.match(describeExit(-1073741571, null), /0xC00000FD: stack overflow/);
  assert.match(describeExit(3221225477, null), /0xC0000005: access violation/);
  assert.match(describeExit(null, "SIGSEGV"), /segmentation fault/);
  assert.equal(describeExit(3, null), "exit code 3");
});
