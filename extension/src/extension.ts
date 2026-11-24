import { existsSync } from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { CompileMessage, parseCompileErrors, parseRuntimeError, sameFile } from "./diagnostics";
import {
  CaseResult,
  DATA_DIR,
  findStressHelpers,
  helperFileName,
  HELPER_TEMPLATES,
  isStressHelper,
  judge,
  JudgeReport,
  LanguageId,
  languageOf,
  ProgramCache,
  runOnInput,
  saveStressCase,
  StressHelper,
  StressOutcome,
  stressTest,
  ToolPaths,
} from "./judge";
import { HistoryStore, JsonFileStore, summariseRun } from "./problems/history";
import { readSourceInfo } from "./problems/install";
import { HINTS_KEY } from "./problems/hints";
import { SOLVED_KEY, SolvedStore } from "./problems/solved";
import { ActivityStore } from "./problems/stats";
import { registerProblems } from "./problems/view";
import { emptyState, ResultsPanel } from "./ui/resultsPanel";

/** Compiled programs, kept for the session; emptied on deactivate. */
const cache = new ProgramCache();

const SELECTOR: vscode.DocumentSelector = [
  { scheme: "file", language: "cpp" },
  { scheme: "file", language: "java" },
  { scheme: "file", language: "python" },
];

/** A solution file is a C++/Java/Python file with a .data folder beside it (and not a stress helper). */
export function isSolutionFile(file: string): boolean {
  return !!languageOf(file) && !isStressHelper(file) && existsSync(path.join(path.dirname(file), DATA_DIR));
}

function tools(): ToolPaths {
  const c = vscode.workspace.getConfiguration("dsaDrill.compilers");
  return { cpp: c.get("cpp"), javac: c.get("javac"), java: c.get("java"), python: c.get("python") };
}

/** The user's time factors; only the languages they set, so meta.json and the defaults fill the rest. */
function timeMultipliers(): Partial<Record<LanguageId, number>> {
  const set = vscode.workspace.getConfiguration("dsaDrill").inspect<Record<string, number>>("timeMultipliers");
  const v = { ...set?.globalValue, ...set?.workspaceValue, ...set?.workspaceFolderValue };
  return Object.fromEntries(Object.entries(v).filter(([, n]) => typeof n === "number" && n > 0)) as Partial<Record<LanguageId, number>>;
}

/** The limits a run used, for the results panel. */
const limitsOf = (r: JudgeReport) => ({ timeLimitMs: r.timeLimitMs, memoryLimitMb: r.memoryLimitMb, memoryMeasured: r.memoryMeasured, checker: r.checker });

const toDiagnostic = (m: CompileMessage, message = m.message) => {
  const range = new vscode.Range(m.line - 1, Math.max(0, m.column - 1), m.line - 1, Number.MAX_SAFE_INTEGER);
  const d = new vscode.Diagnostic(range, message, m.severity === "warning" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error);
  d.source = "dsa-drill";
  return d;
};

export function activate(ctx: vscode.ExtensionContext) {
  const diagnostics = vscode.languages.createDiagnosticCollection("dsa-drill");
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = "dsaDrill.showResults";
  ctx.subscriptions.push(diagnostics, status);

  const solved = new SolvedStore(ctx.globalState);
  ctx.globalState.setKeysForSync([SOLVED_KEY, HINTS_KEY]); // solved problems and opened hints follow the user via Settings Sync
  // its own file, not globalState: see JsonFileStore
  const historyFile = new JsonFileStore(path.join(ctx.globalStorageUri.fsPath, "history.json"));
  const history = new HistoryStore(historyFile);
  const activity = new ActivityStore(historyFile, () => history.allRuns());
  const problems = registerProblems(ctx, solved, history, activity);

  /** Remember a finished Run Tests of a downloaded problem. */
  async function recordRun(file: string, report: JudgeReport) {
    const info = await readSourceInfo(path.dirname(file));
    const language = languageOf(file);
    const summary = summariseRun(report.cases, report.total, !!report.compileError);
    if (!info?.repo || !info.slug || !language || !summary) return;
    await activity.record(summary.verdict === "AC"); // before history.add: its listeners redraw the stats
    await history.add(info.repo, info.slug, { at: new Date().toISOString(), language, ...summary, hash: info.hash });
  }

  /** All tests passed: if this problem came from the repo, remember it as solved. */
  async function recordSolve(file: string) {
    const info = await readSourceInfo(path.dirname(file));
    const language = languageOf(file);
    if (!info?.repo || !info.slug || !language) return; // a local folder, not a downloaded problem
    const first = await solved.mark(info.repo, info.slug, language, info.hash);
    if (first) {
      const title = problems.index?.problems.find((p) => p.slug === info.slug)?.title ?? info.slug;
      const n = problems.solvedSummary();
      vscode.window.showInformationMessage(`Solved "${title}"!${n ? ` (${n})` : ""}`);
    }
  }

  let lastFile: string | undefined;
  let running: AbortController | undefined;
  let customRunning: AbortController | undefined;

  const panel = new ResultsPanel(ctx.extensionUri, {
    rerun: () => lastFile && runTests(vscode.Uri.file(lastFile)),
    stop: () => running?.abort(),
    custom: (input) => lastFile && runCustom(lastFile, input),
    openFile: () => lastFile && vscode.window.showTextDocument(vscode.Uri.file(lastFile), { viewColumn: vscode.ViewColumn.One }),
  });

  /** The file a command should act on: the argument, else the active editor. Saves it first. */
  async function target(uri?: vscode.Uri): Promise<string | undefined> {
    const doc =
      uri && uri.fsPath
        ? vscode.workspace.textDocuments.find((d) => d.uri.fsPath === uri.fsPath)
        : vscode.window.activeTextEditor?.document;
    const file = uri?.fsPath ?? doc?.uri.fsPath;
    if (!file || doc?.isUntitled) {
      vscode.window.showWarningMessage("Open a solution file (solution.cpp, Main.java or solution.py) first.");
      return;
    }
    if (!languageOf(file)) {
      vscode.window.showWarningMessage(`${path.basename(file)} isn't a C++, Java or Python file.`);
      return;
    }
    if (doc?.isDirty) await doc.save();
    return file;
  }

  /** Compiler errors or warnings into the Problems panel (added to what the file already has). */
  function showCompilerOutput(file: string, output: string) {
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const m of parseCompileErrors(output)) {
      const f = sameFile(m.file, file) ? file : path.resolve(path.dirname(file), m.file);
      byFile.set(f, [...(byFile.get(f) ?? []), toDiagnostic(m)]);
    }
    for (const [f, ds] of byFile) {
      const uri = vscode.Uri.file(f);
      diagnostics.set(uri, [...(diagnostics.get(uri) ?? []), ...ds]);
    }
  }

  /** Mark where the first crashed case died, from its traceback / stack trace. */
  function showRuntimeError(file: string, crashed: CaseResult | undefined) {
    if (!crashed) return;
    const m = parseRuntimeError(crashed.stderr, file, crashed.message);
    if (!m) return;
    const uri = vscode.Uri.file(file);
    const label = crashed.name === "custom" ? "Custom input" : `Case ${crashed.name}`;
    diagnostics.set(uri, [...(diagnostics.get(uri) ?? []), toDiagnostic(m, `${label}: ${m.message}`)]);
  }

  function setStatus(text: string, tooltip: string, kind?: "ok" | "bad") {
    status.text = text;
    status.tooltip = tooltip;
    status.backgroundColor = kind === "bad" ? new vscode.ThemeColor("statusBarItem.errorBackground") : undefined;
    status.show();
  }

  async function runTests(uri?: vscode.Uri): Promise<JudgeReport | undefined> {
    const file = await target(uri);
    if (!file) return;
    if (!isSolutionFile(file)) {
      const pick = await vscode.window.showWarningMessage(
        `No ${DATA_DIR} folder next to ${path.basename(file)}, so there are no tests to run.`,
        "Run Custom Input",
      );
      if (pick) await vscode.commands.executeCommand("dsaDrill.runCustomInput", vscode.Uri.file(file));
      return;
    }

    running?.abort();
    const ac = new AbortController();
    running = ac;
    lastFile = file;
    diagnostics.clear();

    panel.show();
    panel.update({ ...emptyState(), custom: panel.current.custom, file, phase: "compiling" });
    setStatus("$(sync~spin) Testing…", "DSA Drill is running the tests");

    const cases: CaseResult[] = [];
    try {
      const report = await judge(file, {
        tools: tools(),
        cache,
        timeMultipliers: timeMultipliers(),
        signal: ac.signal,
        onCase: (r, _i, total) => {
          cases.push(r);
          panel.update({ phase: "running", cases: [...cases], total, passed: cases.filter((c) => c.verdict === "AC").length });
        },
      });
      if (running !== ac) return report; // a newer run took over
      if (report.compileError) {
        showCompilerOutput(file, report.compileError);
        panel.update({ phase: "compileError", compileError: report.compileError, total: report.total, ...limitsOf(report) });
        setStatus("$(error) Compile error", "Click to see the error", "bad");
        await recordRun(file, report).catch((e) => console.error("DSA Drill: couldn't record the run:", e));
      } else {
        const cancelled = ac.signal.aborted;
        if (report.compileWarnings) showCompilerOutput(file, report.compileWarnings);
        showRuntimeError(file, report.cases.find((c) => c.verdict === "RE"));
        if (!cancelled) await recordRun(file, report).catch((e) => console.error("DSA Drill: couldn't record the run:", e));
        panel.update({ phase: cancelled ? "cancelled" : "done", cases: report.cases, total: report.total, passed: report.passed, ...limitsOf(report) });
        const failed = report.cases.some((c) => c.verdict !== "AC" && c.verdict !== "NO_EXPECTED");
        if (cancelled) setStatus(`$(debug-stop) ${report.passed}/${report.total}`, "Stopped");
        else if (failed) setStatus(`$(error) ${report.passed}/${report.total} passed`, "Click to see which cases failed", "bad");
        else setStatus(`$(pass) ${report.passed}/${report.total} passed`, "All tests passed", "ok");
        if (!cancelled && report.total > 0 && report.passed === report.total) {
          await recordSolve(file).catch((e) => console.error("DSA Drill: couldn't record the solve:", e));
        }
      }
      return report;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      panel.update({ phase: "error", error: msg });
      setStatus("$(error) Error", msg, "bad");
      vscode.window.showErrorMessage(msg);
    } finally {
      if (running === ac) running = undefined;
    }
  }

  async function runCustom(file: string, input: string): Promise<CaseResult | { compileError: string }> {
    customRunning?.abort();
    const ac = new AbortController();
    customRunning = ac;
    panel.updateCustom({ running: true, result: undefined, compileError: undefined });
    const timeLimitMs = vscode.workspace.getConfiguration("dsaDrill").get<number>("customInputTimeLimit", 10) * 1000;
    const r = await runOnInput(file, input, { tools: tools(), cache, timeLimitMs, signal: ac.signal });
    if (customRunning === ac) {
      diagnostics.delete(vscode.Uri.file(file));
      if ("compileError" in r) {
        showCompilerOutput(file, r.compileError);
        panel.updateCustom({ running: false, compileError: r.compileError });
      } else {
        if (r.compileWarnings) showCompilerOutput(file, r.compileWarnings);
        if (r.verdict === "RE") showRuntimeError(file, r);
        panel.updateCustom({ running: false, result: r });
      }
      customRunning = undefined;
    }
    return r;
  }

  let stressRunning: AbortController | undefined;

  /** Create gen.py and brute.<solution's language> from templates, and open them. */
  async function createHelpers(problemDir: string, missing: StressHelper[], language: LanguageId) {
    const opened: string[] = [];
    for (const h of missing) {
      const lang: LanguageId = h === "gen" ? "python" : language;
      const f = path.join(problemDir, helperFileName(h, lang));
      await vscode.workspace.fs.writeFile(vscode.Uri.file(f), Buffer.from(HELPER_TEMPLATES[h][lang]));
      opened.push(f);
    }
    for (const [i, f] of opened.entries()) {
      await vscode.window.showTextDocument(vscode.Uri.file(f), { viewColumn: vscode.ViewColumn.Beside, preview: false, preserveFocus: i > 0 });
    }
  }

  async function runStress(uri?: vscode.Uri): Promise<StressOutcome | undefined> {
    const file = await target(uri);
    if (!file) return;
    if (isStressHelper(file)) {
      vscode.window.showWarningMessage("Run the stress test from your solution file, not from gen or brute.");
      return;
    }
    const problemDir = path.dirname(file);
    const helpers = await findStressHelpers(problemDir);
    const missing = (["gen", "brute"] as StressHelper[]).filter((h) => !helpers[h]);
    if (missing.length) {
      const language = languageOf(file)!;
      const names = missing.map((h) => helperFileName(h, h === "gen" ? "python" : language)).join(" and ");
      const pick = await vscode.window.showInformationMessage(
        `The stress test needs a generator (gen.*: prints a random input for the seed in argv[1]) and a brute force (brute.*: a slow but surely correct solution) next to ${path.basename(file)}.`,
        `Create ${names}`,
      );
      if (pick) await createHelpers(problemDir, missing, language);
      return { kind: "missingHelpers", missing };
    }
    // save open helpers too, so the run uses what's on screen
    for (const h of Object.values(helpers)) await vscode.workspace.textDocuments.find((d) => d.uri.fsPath === h && d.isDirty)?.save();

    stressRunning?.abort();
    const ac = new AbortController();
    stressRunning = ac;
    lastFile = file;
    diagnostics.clear();
    const runs = Math.max(1, Math.floor(vscode.workspace.getConfiguration("dsaDrill").get<number>("stressRuns", 200)));
    setStatus("$(sync~spin) Stress testing…", "DSA Drill is comparing your solution with brute");

    const outcome = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Stress testing ${path.basename(file)}`, cancellable: true },
      async (progress, token) => {
        token.onCancellationRequested(() => ac.abort());
        let shown = 0;
        return stressTest(file, {
          tools: tools(),
          cache,
          runs,
          timeMultipliers: timeMultipliers(),
          signal: ac.signal,
          onProgress: (seed, n) => {
            const pct = Math.floor(((seed - 1) / n) * 100);
            progress.report({ message: `seed ${seed}/${n}`, increment: pct - shown });
            shown = pct;
          },
        });
      },
    ).then(
      (o) => o,
      (e): StressOutcome | undefined => {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus("$(error) Stress test error", msg, "bad");
        vscode.window.showErrorMessage(msg);
        return undefined;
      },
    );
    if (stressRunning === ac) stressRunning = undefined;
    else return outcome; // a newer stress run took over
    if (!outcome) return;

    const rel = (f: string) => path.basename(f);
    switch (outcome.kind) {
      case "passed":
        setStatus(`$(pass) Stress: ${outcome.runs} ok`, `Your solution agreed with brute on ${outcome.runs} random inputs`, "ok");
        vscode.window.showInformationMessage(`No difference from brute on ${outcome.runs} random inputs.`);
        break;
      case "cancelled":
        setStatus(`$(debug-stop) Stress: ${outcome.runs} ok`, "Stopped");
        break;
      case "compileError":
        showCompilerOutput(outcome.file, outcome.error);
        panel.show();
        panel.update({ ...emptyState(), custom: panel.current.custom, file, phase: "compileError", compileError: outcome.error, note: `Stress test: ${rel(outcome.file)} did not compile.` });
        setStatus("$(error) Compile error", `${rel(outcome.file)} did not compile`, "bad");
        break;
      case "helperFailed": {
        const msg = `Stress test: ${rel(outcome.file)} ${outcome.message.split("\n")[0]} on seed ${outcome.seed}. Fix ${rel(outcome.file)} (your solution wasn't judged on this seed).`;
        panel.show();
        panel.update({
          ...emptyState(),
          custom: panel.current.custom,
          file,
          phase: "error",
          error: `${rel(outcome.file)} ${outcome.message}` + (outcome.input !== undefined ? `\n\nInput (seed ${outcome.seed}):\n${outcome.input}` : ""),
          note: msg,
        });
        setStatus("$(error) Stress: helper failed", msg, "bad");
        const open = await vscode.window.showErrorMessage(msg, `Open ${rel(outcome.file)}`);
        if (open) await vscode.window.showTextDocument(vscode.Uri.file(outcome.file));
        break;
      }
      case "found": {
        const r = outcome.result;
        const saved = await saveStressCase(problemDir, r.name, r.input, r.expected ?? "");
        showRuntimeError(file, r.verdict === "RE" ? r : undefined);
        panel.show();
        panel.update({
          ...emptyState(),
          custom: panel.current.custom,
          file,
          phase: "done",
          cases: [r],
          total: 1,
          passed: 0,
          timeLimitMs: outcome.timeLimitMs,
          memoryLimitMb: outcome.memoryLimitMb,
          memoryMeasured: outcome.memoryMeasured,
          checker: outcome.checker,
          note: `Stress test: ${r.verdict} on seed ${outcome.seed} (expected = brute's output${outcome.checker ? ", judged by the checker" : ""}). Saved as ${DATA_DIR}/${path.basename(saved)} and .out, so Run Tests includes it from now on.`,
        });
        setStatus(`$(error) Stress: ${r.verdict} on seed ${outcome.seed}`, "Click to see the failing input", "bad");
        break;
      }
    }
    return outcome;
  }

  const lensEmitter = new vscode.EventEmitter<void>();
  ctx.subscriptions.push(
    lensEmitter,
    vscode.commands.registerCommand("dsaDrill.runTests", (uri?: vscode.Uri) => runTests(uri)),
    vscode.commands.registerCommand("dsaDrill.runCustomInput", async (uri?: vscode.Uri, input?: string) => {
      const file = await target(uri);
      if (!file) return;
      lastFile = file;
      if (panel.current.file !== file) panel.update({ ...emptyState(), file });
      panel.show({ focusCustomInput: input === undefined });
      // `input` is passed by tests / other commands; normally the user types it in the panel
      if (input !== undefined) return runCustom(file, input);
    }),
    vscode.commands.registerCommand("dsaDrill.stressTest", (uri?: vscode.Uri) => runStress(uri)),
    vscode.commands.registerCommand("dsaDrill.stop", () => {
      running?.abort();
      customRunning?.abort();
      stressRunning?.abort();
    }),
    vscode.commands.registerCommand("dsaDrill.showResults", () => panel.show()),
    vscode.languages.registerCodeLensProvider(SELECTOR, {
      onDidChangeCodeLenses: lensEmitter.event,
      async provideCodeLenses(doc) {
        if (!vscode.workspace.getConfiguration("dsaDrill").get("codeLens", true)) return [];
        if (!isSolutionFile(doc.uri.fsPath)) return [];
        const top = new vscode.Range(0, 0, 0, 0);
        const lenses = [
          new vscode.CodeLens(top, { title: "▶ Run Tests", command: "dsaDrill.runTests", arguments: [doc.uri] }),
          new vscode.CodeLens(top, { title: "Run Custom Input", command: "dsaDrill.runCustomInput", arguments: [doc.uri] }),
          new vscode.CodeLens(top, { title: "Stress Test", command: "dsaDrill.stressTest", arguments: [doc.uri] }),
        ];
        const info = await readSourceInfo(path.dirname(doc.uri.fsPath));
        const entry = info && info.repo === problems.source?.label ? problems.index?.problems.find((p) => p.slug === info.slug) : undefined;
        if (entry?.hints) lenses.push(new vscode.CodeLens(top, { title: `Hints (${entry.hints})`, command: "dsaDrill.showHints", arguments: [entry.slug] }));
        return lenses;
      },
    }),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("dsaDrill") && lensEmitter.fire()),
    problems.onDidChangeTreeData(() => lensEmitter.fire()), // the index (and its hint counts) arrived
    vscode.workspace.onDidChangeTextDocument((e) => {
      // compile errors go stale as soon as the file is edited
      if (diagnostics.has(e.document.uri)) diagnostics.delete(e.document.uri);
    }),
  );

  const updateContext = (editor?: vscode.TextEditor) =>
    vscode.commands.executeCommand("setContext", "dsaDrill.activeIsSolution", !!editor && editor.document.uri.scheme === "file" && isSolutionFile(editor.document.uri.fsPath));
  updateContext(vscode.window.activeTextEditor);
  ctx.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateContext));

  // for the VS Code tests only
  return {
    _test: {
      rendered: () => panel.lastRendered,
      problems: () => problems.snapshot(),
      filter: () => problems.filter,
      diagnostics: (file: string) => diagnostics.get(vscode.Uri.file(file))?.map((d) => ({ line: d.range.start.line + 1, message: d.message, severity: d.severity })) ?? [],
      history,
      activity,
    },
  };
}

export function deactivate() {
  return cache.clear();
}
