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
  assert.deepEqual(lenses.map((l) => l.command?.title), ["▶ Run Tests", "Run Custom Input"]);
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

type Row = { slug?: string; group?: string; local?: boolean; outdated?: boolean; message?: string };
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
    { slug: "add-two", group: "easy", local: false, outdated: false },
    { slug: "max-pair", group: "medium", local: false, outdated: false },
  ]);
});

it("opening a problem downloads it, writes the repo's starter and opens it", async () => {
  const r = await vscode.commands.executeCommand<Installed>("dsaDrill.openProblem", "add-two", "python");
  assert.ok(r?.createdSolution, JSON.stringify(r));
  assert.equal(r.solution, path.join(ws(), "add-two", "solution.py"));
  assert.match(await read("add-two/solution.py"), /^a, b = map\(int/);
  assert.equal(await read("add-two/.data/02.out"), "42\n");
  assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, r.solution);
  assert.deepEqual(rows()[0], { slug: "add-two", group: "easy", local: true, outdated: false });
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
});

it("changed tests are flagged, and updating keeps the solution", async () => {
  const data = path.join(repo(), "problems", "add-two", ".data");
  await fs.writeFile(path.join(data, "03.in"), "-5 5\n");
  await fs.writeFile(path.join(data, "03.out"), "0\n");
  await vscode.commands.executeCommand("dsaDrill.refreshProblems");
  assert.deepEqual(rows()[0], { slug: "add-two", group: "easy", local: true, outdated: true });
  assert.deepEqual(rows()[1], { slug: "max-pair", group: "medium", local: true, outdated: false });

  assert.equal(await vscode.commands.executeCommand("dsaDrill.updateProblem", "add-two"), 1);
  assert.equal(await read("add-two/.data/03.out"), "0\n");
  assert.match(await read("add-two/solution.py"), /print\(a \+ b\)/);
  assert.equal(rows()[0].outdated, false);
  const report = await vscode.commands.executeCommand<JudgeReport>("dsaDrill.runTests", vscode.Uri.file(path.join(ws(), "add-two", "solution.py")));
  assert.equal(report.passed, 3);
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
