/** Runs inside VS Code (extension host). Exports run() as @vscode/test-electron expects. */
import * as assert from "node:assert/strict";
import { promises as fs } from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { CaseResult, JudgeReport } from "../../src/judge";

const tests: [string, () => Promise<void>][] = [];
const it = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);

const ws = () => vscode.workspace.workspaceFolders![0].uri.fsPath;
const open = async (rel: string) => {
  const doc = await vscode.workspace.openTextDocument(path.join(ws(), rel));
  await vscode.window.showTextDocument(doc);
  return doc;
};

it("activates when a solution file is opened", async () => {
  await open("max-subarray/solution.cpp");
  const ext = vscode.extensions.all.find((e) => e.packageJSON.name === "dsa-drill");
  assert.ok(ext, "extension not found");
  await ext.activate();
  assert.ok(ext.isActive);
});

it(".data is hidden and the default excludes are kept", async () => {
  const ex = vscode.workspace.getConfiguration("files").get<Record<string, boolean>>("exclude")!;
  assert.equal(ex["**/.data"], true, JSON.stringify(ex));
  assert.equal(ex["**/.git"], true, "default **/.git exclude was lost: " + JSON.stringify(ex));
});

it("shows Run Tests CodeLens on solution files only", async () => {
  const doc = await open("max-subarray/solution.cpp");
  const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>("vscode.executeCodeLensProvider", doc.uri);
  assert.deepEqual(lenses.map((l) => l.command?.title), ["▶ Run Tests", "Run Custom Input", "Stress Test"]);
  const md = await open("max-subarray/problem.md");
  const none = await vscode.commands.executeCommand<vscode.CodeLens[]>("vscode.executeCodeLensProvider", md.uri);
  assert.equal(none.length, 0);
});

it("runs C++ tests: the buggy max-subarray fails cases 04 and 05", async () => {
  const doc = await open("max-subarray/solution.cpp");
  const r = await vscode.commands.executeCommand<JudgeReport>("dsaDrill.runTests", doc.uri);
  assert.deepEqual(r.cases.map((c) => c.verdict), ["AC", "AC", "AC", "WA", "WA"]);
  assert.equal(r.timeLimitMs, 1000, "meta.json time limit");

  // the results panel's script loaded (CSP ok) and drew the summary and the failing case
  const api = vscode.extensions.all.find((e) => e.packageJSON.name === "dsa-drill")!.exports;
  let drawn: { header: string; cases: string } | undefined;
  for (let i = 0; i < 50; i++) {
    drawn = api._test.rendered();
    if (drawn?.header.includes("3/5 passed")) break;
    await new Promise((res) => setTimeout(res, 100));
  }
  assert.ok(drawn, "results panel never rendered (script blocked?)");
  assert.match(drawn.header, /solution\.cpp[\s\S]*3\/5 passed/);
  assert.match(drawn.cases, /WA[\s\S]*Case 04[\s\S]*First difference on line 1/);
});

it("saves unsaved edits before running", async () => {
  const doc = await open("max-subarray/solution.cpp");
  const fixed = doc.getText().replace("long long best = 0;", "long long best = a[0];");
  assert.notEqual(fixed, doc.getText(), "fixture no longer contains the planted bug");
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), fixed);
  await vscode.workspace.applyEdit(edit);
  assert.ok(doc.isDirty);
  const r = await vscode.commands.executeCommand<JudgeReport>("dsaDrill.runTests", doc.uri);
  assert.equal(r.passed, 5, JSON.stringify(r.cases.map((c) => c.verdict)));
  assert.ok(!doc.isDirty);
});

it("runs Python tests", async () => {
  const doc = await open("sum-python/solution.py");
  const r = await vscode.commands.executeCommand<JudgeReport>("dsaDrill.runTests", doc.uri);
  assert.equal(r.passed, 2);
});

it("puts compile errors in the Problems panel", async () => {
  const dir = path.join(ws(), "broken");
  await fs.mkdir(path.join(dir, ".data"), { recursive: true });
  await fs.writeFile(path.join(dir, ".data", "1.in"), "1\n");
  await fs.writeFile(path.join(dir, "solution.cpp"), "#include <cstdio>\nint main() {\n  printf(\"%d\", x);\n}\n");
  const doc = await open("broken/solution.cpp");
  const r = await vscode.commands.executeCommand<JudgeReport>("dsaDrill.runTests", doc.uri);
  assert.ok(r.compileError);
  const diags = vscode.languages.getDiagnostics(doc.uri).filter((d) => d.source === "dsa-drill");
  assert.ok(diags.length > 0, "no diagnostics");
  assert.equal(diags[0].range.start.line, 2);
  assert.equal(diags[0].severity, vscode.DiagnosticSeverity.Error);
});

it("runs custom input", async () => {
  const doc = await open("sum-python/solution.py");
  const r = await vscode.commands.executeCommand<CaseResult>("dsaDrill.runCustomInput", doc.uri, "2\n40 2\n");
  assert.equal(r.output.trim(), "42");
});

it("a file without .data gets no CodeLens", async () => {
  await fs.writeFile(path.join(ws(), "scratch.py"), "print(1)\n");
  const doc = await open("scratch.py");
  const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>("vscode.executeCodeLensProvider", doc.uri);
  assert.equal(lenses.length, 0);
});

// ---- problems sidebar, against a local fixture repo (no network) ----

type Row = { slug?: string; group?: string; local?: boolean; outdated?: boolean; solved?: boolean; message?: string };
const repo = () => process.env.DSA_DRILL_TEST_REPO!;
const rows = (): Row[] => vscode.extensions.all.find((e) => e.packageJSON.name === "dsa-drill")!.exports._test.problems();
const read = (rel: string) => fs.readFile(path.join(ws(), rel), "utf8");
type Installed = { dir: string; solution?: string; createdSolution: boolean };

it("lists the repo's problems grouped by difficulty", async () => {
  assert.ok(repo(), "DSA_DRILL_TEST_REPO not set");
  assert.equal(vscode.workspace.getConfiguration("dsaDrill").get("repo"), "realksm/dsa-practice", "default repo");
  await vscode.workspace.getConfiguration("dsaDrill").update("repo", repo(), vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand("dsaDrill.refreshProblems");
  assert.deepEqual(rows(), [
    { slug: "add-two", group: "easy", local: false, outdated: false, solved: false },
    { slug: "max-pair", group: "medium", local: false, outdated: false, solved: false },
  ]);
});

it("opening a problem downloads it, writes the repo's starter and opens it", async () => {
  const r = await vscode.commands.executeCommand<Installed>("dsaDrill.openProblem", "add-two", "python");
  assert.ok(r?.createdSolution, JSON.stringify(r));
  assert.equal(r.solution, path.join(ws(), "add-two", "solution.py"));
  assert.match(await read("add-two/solution.py"), /^a, b = map\(int/);
  assert.equal(await read("add-two/.data/02.out"), "42\n");
  assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, r.solution);
  assert.deepEqual(rows()[0], { slug: "add-two", group: "easy", local: true, outdated: false, solved: false });
});

it("a downloaded problem runs its tests (built-in C++ starter, no repo starter)", async () => {
  const r = await vscode.commands.executeCommand<Installed>("dsaDrill.openProblem", "max-pair", "cpp");
  assert.match(await read("max-pair/solution.cpp"), /int main\(\)/);
  const report = await vscode.commands.executeCommand<JudgeReport>("dsaDrill.runTests", vscode.Uri.file(r.solution!));
  assert.deepEqual(report.cases.map((c) => c.verdict), ["WA", "WA"], "the empty starter prints nothing");
  assert.equal(report.timeLimitMs, 1000, "meta.json was downloaded");
});

it("opening again never overwrites your solution", async () => {
  await fs.writeFile(path.join(ws(), "add-two", "solution.py"), "a, b = map(int, input().split())\nprint(a + b)\n");
  // no language given and exactly one solution exists: it reopens that one without asking
  const r = await vscode.commands.executeCommand<Installed>("dsaDrill.openProblem", "add-two");
  assert.equal(r.createdSolution, false);
  assert.match(await read("add-two/solution.py"), /print\(a \+ b\)/);
  const report = await vscode.commands.executeCommand<JudgeReport>("dsaDrill.runTests", vscode.Uri.file(r.solution!));
  assert.equal(report.passed, 2);
  assert.equal(rows()[0].solved, true, "all tests passed: add-two is solved");
  assert.equal(rows()[1].solved, false, "max-pair failed its tests");
});

it("changed tests are flagged, and updating keeps the solution", async () => {
  const data = path.join(repo(), "problems", "add-two", ".data");
  await fs.writeFile(path.join(data, "03.in"), "-5 5\n");
  await fs.writeFile(path.join(data, "03.out"), "0\n");
  await vscode.commands.executeCommand("dsaDrill.refreshProblems");
  assert.deepEqual(rows()[0], { slug: "add-two", group: "easy", local: true, outdated: true, solved: true });
  assert.deepEqual(rows()[1], { slug: "max-pair", group: "medium", local: true, outdated: false, solved: false });

  assert.equal(await vscode.commands.executeCommand("dsaDrill.updateProblem", "add-two"), 1);
  assert.equal(await read("add-two/.data/03.out"), "0\n");
  assert.match(await read("add-two/solution.py"), /print\(a \+ b\)/);
  assert.equal(rows()[0].outdated, false);
  const report = await vscode.commands.executeCommand<JudgeReport>("dsaDrill.runTests", vscode.Uri.file(path.join(ws(), "add-two", "solution.py")));
  assert.equal(report.passed, 3);
});

it("the filter hides solved problems and narrows by tag", async () => {
  const slugs = () => rows().map((r) => r.slug ?? r.message);
  await vscode.commands.executeCommand("dsaDrill.filterProblems", { tags: [], hideSolved: true });
  assert.deepEqual(slugs(), ["max-pair"]);
  await vscode.commands.executeCommand("dsaDrill.filterProblems", { tags: ["math"], hideSolved: false });
  assert.deepEqual(slugs(), ["add-two"]);
  await vscode.commands.executeCommand("dsaDrill.filterProblems", { tags: ["math"], hideSolved: true });
  assert.deepEqual(slugs(), ["No problems match the filter."]);
  await vscode.commands.executeCommand("dsaDrill.clearFilter");
  assert.deepEqual(slugs(), ["add-two", "max-pair"]);
});

it("Mark as Unsolved clears the solved state", async () => {
  await vscode.commands.executeCommand("dsaDrill.markUnsolved", "add-two");
  assert.equal(rows()[0].solved, false);
});

it("compiler warnings and runtime crash lines go to the Problems panel", async () => {
  const dir = path.join(ws(), "warn");
  await fs.mkdir(path.join(dir, ".data"), { recursive: true });
  await fs.writeFile(path.join(dir, ".data", "1.in"), "0\n");
  await fs.writeFile(path.join(dir, ".data", "1.out"), "0\n");
  await fs.writeFile(path.join(dir, "solution.cpp"), "#include <cstdio>\nint main() {\n  int unused;\n  printf(\"0\\n\");\n}\n");
  const doc = await open("warn/solution.cpp");
  const r = await vscode.commands.executeCommand<JudgeReport>("dsaDrill.runTests", doc.uri);
  assert.equal(r.passed, 1);
  const warn = vscode.languages.getDiagnostics(doc.uri).filter((d) => d.source === "dsa-drill");
  assert.ok(warn.some((d) => d.severity === vscode.DiagnosticSeverity.Warning && d.range.start.line === 2), JSON.stringify(warn));

  await fs.writeFile(path.join(dir, "solution.py"), "n = int(input())\nprint(5 // n)\n");
  const py = await open("warn/solution.py");
  const pr = await vscode.commands.executeCommand<JudgeReport>("dsaDrill.runTests", py.uri);
  assert.equal(pr.cases[0].verdict, "RE");
  const crash = vscode.languages.getDiagnostics(py.uri).filter((d) => d.source === "dsa-drill");
  assert.equal(crash.length, 1, JSON.stringify(crash));
  assert.equal(crash[0].range.start.line, 1);
  assert.match(crash[0].message, /^Case 1: ZeroDivisionError/);
});

it("stress test finds a wrong answer, saves it as a test and shows it", async () => {
  const dir = path.join(ws(), "stress");
  await fs.mkdir(path.join(dir, ".data"), { recursive: true });
  await fs.writeFile(path.join(dir, "gen.py"), "import random, sys\nrandom.seed(int(sys.argv[1]))\nprint(random.randint(-9, 9))\n");
  await fs.writeFile(path.join(dir, "brute.py"), "print(int(input()) * 2)\n");
  await fs.writeFile(path.join(dir, "solution.py"), "print(abs(int(input())) * 2)\n");
  const gen = await open("stress/gen.py");
  const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>("vscode.executeCodeLensProvider", gen.uri);
  assert.equal(lenses.length, 0, "no Run Tests on the helpers");

  const doc = await open("stress/solution.py");
  const o = await vscode.commands.executeCommand<{ kind: string; seed: number; result: CaseResult }>("dsaDrill.stressTest", doc.uri);
  assert.equal(o.kind, "found", JSON.stringify(o));
  assert.equal(o.result.verdict, "WA");
  const saved = await read(`stress/.data/stress-${o.seed}.in`);
  assert.equal(saved, o.result.input);
  assert.ok(Number(await read(`stress/.data/stress-${o.seed}.out`)) < 0);

  // fixed: the saved case now passes in Run Tests, and the stress test finds nothing
  await fs.writeFile(path.join(dir, "solution.py"), "print(int(input()) * 2)\n");
  const report = await vscode.commands.executeCommand<JudgeReport>("dsaDrill.runTests", doc.uri);
  assert.ok(report.cases.some((c) => c.name === `stress-${o.seed}` && c.verdict === "AC"));
  await vscode.workspace.getConfiguration("dsaDrill").update("stressRuns", 20, vscode.ConfigurationTarget.Global);
  const again = await vscode.commands.executeCommand<{ kind: string; runs: number }>("dsaDrill.stressTest", doc.uri);
  assert.deepEqual(again, { kind: "passed", runs: 20 });
  await vscode.workspace.getConfiguration("dsaDrill").update("stressRuns", undefined, vscode.ConfigurationTarget.Global);
});

it("run history records each Run Tests of a downloaded problem", async () => {
  const api = vscode.extensions.all.find((e) => e.packageJSON.name === "dsa-drill")!.exports._test;
  const runs = await vscode.commands.executeCommand<{ verdict: string; passed: number; total: number; language: string }[]>("dsaDrill.showHistory", "add-two");
  // add-two ran three times above: 2/2 AC, then (after the test update) 3/3 AC ... newest first
  assert.ok(runs.length >= 2, JSON.stringify(runs));
  assert.deepEqual({ ...runs[0], at: undefined, maxTimeMs: undefined, hash: undefined, peakMb: undefined }, { verdict: "AC", passed: 3, total: 3, language: "python", at: undefined, maxTimeMs: undefined, hash: undefined, peakMb: undefined });
  assert.ok(api.history.runs(JSON.parse(await read("max-pair/.data/.source.json")).repo, "max-pair").some((r: { verdict: string }) => r.verdict === "WA"));
  await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
});

it("hints open one at a time, are remembered, and get a CodeLens", async () => {
  type Shown = { title: string; shown: string[]; total: number };
  const first = await vscode.commands.executeCommand<Shown>("dsaDrill.showHints", "add-two");
  assert.deepEqual(first, { title: "Add Two", shown: [], total: 2 }, "nothing opened yet");
  assert.deepEqual((await vscode.commands.executeCommand<Shown>("dsaDrill.hintAction", "next")).shown, ["Read both numbers"]);
  assert.deepEqual((await vscode.commands.executeCommand<Shown>("dsaDrill.hintAction", "next")).shown, ["Read both numbers", "Add them"]);
  assert.equal((await vscode.commands.executeCommand<Shown>("dsaDrill.hintAction", "next")).shown.length, 2, "can't go past the last");
  const again = await vscode.commands.executeCommand<Shown>("dsaDrill.showHints", "add-two");
  assert.equal(again.shown.length, 2, "remembered");
  assert.deepEqual((await vscode.commands.executeCommand<Shown>("dsaDrill.hintAction", "reset")).shown, []);
  assert.ok(!(await fs.readdir(path.join(ws(), "add-two"))).includes("hints.md"), "hints aren't downloaded");

  const doc = await open("add-two/solution.py");
  const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>("vscode.executeCodeLensProvider", doc.uri);
  assert.deepEqual(lenses.map((l) => l.command?.title), ["▶ Run Tests", "Run Custom Input", "Stress Test", "Hints (2)"]);
  const none = await vscode.commands.executeCommand<Shown | undefined>("dsaDrill.showHints", "max-pair");
  assert.equal(none, undefined, "max-pair has no hints");
});

it("stats count solved problems and today's runs", async () => {
  const s = await vscode.commands.executeCommand<{ solved: number; total: number; streak: { current: number; activeToday: boolean }; runs: number; byDifficulty: { name: string }[] }>(
    "dsaDrill.showStats",
  );
  assert.equal(s.total, 2);
  assert.ok(s.runs >= 3, `runs above were recorded: ${s.runs}`);
  assert.equal(s.streak.current, 1);
  assert.equal(s.streak.activeToday, true);
  assert.deepEqual(s.byDifficulty.map((d) => d.name), ["Easy", "Medium"]);
});

it("memory: MLE over meta.json's limit, peak memory in the panel", async () => {
  const dir = path.join(ws(), "memory");
  await fs.mkdir(path.join(dir, ".data"), { recursive: true });
  await fs.writeFile(path.join(dir, "meta.json"), '{"memoryLimit": 64}');
  await fs.writeFile(path.join(dir, ".data", "1.in"), "8\n");
  await fs.writeFile(path.join(dir, ".data", "1.out"), "8\n");
  await fs.writeFile(path.join(dir, ".data", "2.in"), "200\n");
  await fs.writeFile(path.join(dir, ".data", "2.out"), "200\n");
  await fs.writeFile(
    path.join(dir, "solution.cpp"),
    "#include <bits/stdc++.h>\nint main(){ int mb; std::cin >> mb; std::vector<char> v((size_t)mb << 20, 1); long long s = 0;\n" +
      "for (size_t i = 0; i < v.size(); i += 4096) s += v[i]; std::cout << s / 256 << \"\\n\"; }\n",
  );
  const doc = await open("memory/solution.cpp");
  const r = await vscode.commands.executeCommand<JudgeReport>("dsaDrill.runTests", doc.uri);
  assert.deepEqual(r.cases.map((c) => c.verdict), ["AC", "MLE"]);
  assert.equal(r.memoryLimitMb, 64);
  const api = vscode.extensions.all.find((e) => e.packageJSON.name === "dsa-drill")!.exports;
  let drawn: { header: string; cases: string } | undefined;
  for (let i = 0; i < 50; i++) {
    drawn = api._test.rendered();
    if (drawn?.cases.includes("MLE")) break;
    await new Promise((res) => setTimeout(res, 100));
  }
  assert.match(drawn?.header ?? "", /limit 2s, 64 MB · slowest \d+ ms · peak \d+(\.\d)? MB/);
  assert.match(drawn?.cases ?? "", /MLE[\s\S]*Case 2[\s\S]*64 MB memory limit/);
});

it("a problem's checker accepts any right answer", async () => {
  const dir = path.join(ws(), "checked");
  await fs.mkdir(path.join(dir, ".data"), { recursive: true });
  await fs.writeFile(path.join(dir, ".data", "1.in"), "10\n");
  await fs.writeFile(path.join(dir, ".data", "1.out"), "3 7\n");
  // any two positive numbers that add up to n
  await fs.writeFile(
    path.join(dir, ".data", "checker.py"),
    "import sys\nn = int(open(sys.argv[1]).read())\nout = open(sys.argv[2]).read().split()\n" +
      "ok = len(out) == 2 and all(x.isdigit() and int(x) > 0 for x in out) and sum(map(int, out)) == n\n" +
      "print('' if ok else 'not two positive numbers adding up to %d' % n)\nsys.exit(0 if ok else 1)\n",
  );
  await fs.writeFile(path.join(dir, "solution.py"), "n = int(input())\nprint(1, n - 1)\n");
  const doc = await open("checked/solution.py");
  const ok = await vscode.commands.executeCommand<JudgeReport>("dsaDrill.runTests", doc.uri);
  assert.equal(ok.cases[0].verdict, "AC", "1 9 differs from the .out but is right");
  assert.equal(ok.checker, "checker.py");
  await fs.writeFile(path.join(dir, "solution.py"), "n = int(input())\nprint(0, n)\n");
  const bad = await vscode.commands.executeCommand<JudgeReport>("dsaDrill.runTests", doc.uri);
  assert.equal(bad.cases[0].verdict, "WA");
  assert.match(bad.cases[0].message ?? "", /not two positive numbers adding up to 10/);
});

it("a bad repo setting shows a message in the sidebar instead of failing", async () => {
  await vscode.workspace.getConfiguration("dsaDrill").update("repo", path.join(repo(), "nope"), vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand("dsaDrill.refreshProblems");
  const [msg] = rows();
  assert.match(msg.message ?? "", /doesn't exist/);
  await vscode.workspace.getConfiguration("dsaDrill").update("repo", undefined, vscode.ConfigurationTarget.Global);
});

export async function run(): Promise<void> {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✔ ${name}`);
    } catch (e) {
      failed++;
      console.log(`  ✖ ${name}\n    ${(e as Error).stack ?? e}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  if (failed) throw new Error(`${failed} VS Code test(s) failed`);
}
