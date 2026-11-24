/**
 * Runs inside VS Code (like test/vscode/suite.ts) and walks through the features a new user sees,
 * saving a screenshot of the window after each step into docs/screenshots/ (capture.ps1).
 * Started by test/shots/run.ts: npm run screenshots (Windows only).
 */
import { execFile } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";
import * as vscode from "vscode";

const OUT = process.env.DSA_DRILL_SHOTS_OUT!;
const CAPTURE = process.env.DSA_DRILL_SHOTS_CAPTURE!;
const ws = () => vscode.workspace.workspaceFolders![0].uri.fsPath;
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const cmd = <T = unknown>(id: string, ...args: unknown[]) => vscode.commands.executeCommand<T>(id, ...args);

function capture(args: string[]): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", CAPTURE, "-Title", "Extension Development Host", ...args], (err, _o, stderr) =>
      err ? reject(new Error(stderr || String(err))) : resolve(),
    ),
  );
}

async function shot(name: string, settle = 1500, keepToasts = false) {
  await sleep(settle); // webviews and CodeLens draw asynchronously
  if (!keepToasts) {
    await cmd("notifications.clearAll");
    await sleep(300);
  }
  await capture(["-Out", path.join(OUT, `${name}.png`)]);
  console.log(`saved ${name}.png`);
}

async function write(rel: string, text: string) {
  await fs.mkdir(path.dirname(path.join(ws(), rel)), { recursive: true });
  await fs.writeFile(path.join(ws(), rel), text);
}

async function openAt(rel: string, column = vscode.ViewColumn.One) {
  const doc = await vscode.workspace.openTextDocument(path.join(ws(), rel));
  await vscode.window.showTextDocument(doc, { viewColumn: column, preview: false });
  return doc;
}

const KADANE_BUG = `#include <bits/stdc++.h>
using namespace std;

int main() {
    int n;
    cin >> n;
    vector<long long> a(n);
    for (auto& x : a) cin >> x;

    long long best = 0, cur = 0;   // bug: an all-negative array answers 0
    for (long long x : a) {
        cur = max(x, cur + x);
        best = max(best, cur);
    }
    cout << best << "\\n";
}
`;

const KADANE = KADANE_BUG.replace("long long best = 0, cur = 0;   // bug: an all-negative array answers 0", "long long best = a[0], cur = 0;");

const CRASH = `#include <bits/stdc++.h>
using namespace std;

int main() {
    int n;
    cin >> n;
    vector<long long> a(n);
    for (auto& x : a) cin >> x;

    long long best = a[0], cur = 0;
    for (int i = 0; i <= n; i++) {        // one step too far
        cur = max(a.at(i), cur + a.at(i));
        best = max(best, cur);
    }
    cout << best << "\\n";
}
`;

export async function run(): Promise<void> {
  await fs.mkdir(OUT, { recursive: true });
  await capture(["-Width", "1600", "-Height", "1000"]);
  const ext = vscode.extensions.all.find((e) => e.packageJSON.name === "dsa-drill")!;
  await ext.activate();
  await cmd("dsaDrill.refreshProblems");

  // 1. The sidebar: problems by difficulty. Opening one shows the statement beside a starter.
  await cmd("workbench.view.extension.dsaDrill");
  await sleep(800);
  await cmd("dsaDrill.openProblem", "max-subarray", "cpp");
  await shot("01-open-problem", 3000);
  await cmd("workbench.action.closeEditorsInOtherGroups");

  // 2. A solution with a bug: Run Tests shows which cases fail and the first difference.
  await write("max-subarray/solution.cpp", KADANE_BUG);
  const sol = await openAt("max-subarray/solution.cpp");
  await cmd("dsaDrill.runTests", sol.uri);
  await shot("02-run-tests-wrong-answer", 2500);

  // 3. Stress test: a generator and a brute force find a small input that breaks it.
  await write(
    "max-subarray/gen.py",
    "import random, sys\nrandom.seed(int(sys.argv[1]))\nn = random.randint(1, 5)\nprint(n)\nprint(*[random.randint(-9, 9) for _ in range(n)])\n",
  );
  await write(
    "max-subarray/brute.py",
    "n = int(input())\na = list(map(int, input().split()))\nprint(max(sum(a[l:r + 1]) for l in range(n) for r in range(l, n)))\n",
  );
  await cmd("dsaDrill.stressTest", sol.uri);
  await shot("03-stress-test", 2000);

  // 4. Custom input: run your own input, no expected output needed.
  await cmd("dsaDrill.runCustomInput", sol.uri, "6\n2 -1 3 -8 4 4\n");
  await shot("04-custom-input", 2000);

  // 5. Hints, one at a time.
  await cmd("dsaDrill.showHints", "max-subarray");
  await cmd("dsaDrill.hintAction", "next");
  await cmd("dsaDrill.hintAction", "next");
  await shot("05-hints", 2000);
  await cmd("workbench.action.closeEditorsInOtherGroups");

  // 6. A crash points at its line, in the results and in the editor (and the Problems panel).
  await write("max-subarray/solution.cpp", CRASH);
  const crashed = await openAt("max-subarray/solution.cpp");
  await cmd("dsaDrill.runTests", crashed.uri);
  await shot("06-crash-line", 2500);

  // 7. Fixed: every test passes and the problem gets a check mark in the sidebar.
  await write("max-subarray/solution.cpp", KADANE);
  const fixed = await openAt("max-subarray/solution.cpp");
  await cmd("dsaDrill.runTests", fixed.uri);
  await shot("07-all-passed", 2500, true);
  await cmd("notifications.clearAll");

  // 8. Run history for the problem.
  await cmd("dsaDrill.showHistory", "max-subarray");
  await shot("08-run-history", 1500, true);
  await cmd("workbench.action.closeQuickOpen");

  // 9. Stats: solved per difficulty and tag, streak, a year of activity.
  await cmd("workbench.action.closeAllEditors");
  await cmd("dsaDrill.showStats");
  await shot("09-stats", 2500);
}
