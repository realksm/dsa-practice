import { existsSync } from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { parseCompileErrors, sameFile } from "./diagnostics";
import { CaseResult, DATA_DIR, judge, JudgeReport, languageOf, runOnInput, ToolPaths } from "./judge";
import { registerProblems } from "./problems/view";
import { emptyState, ResultsPanel } from "./ui/resultsPanel";

const SELECTOR: vscode.DocumentSelector = [
  { scheme: "file", language: "cpp" },
  { scheme: "file", language: "java" },
  { scheme: "file", language: "python" },
];

/** A solution file is a C++/Java/Python file with a .data folder beside it. */
export function isSolutionFile(file: string): boolean {
  return !!languageOf(file) && existsSync(path.join(path.dirname(file), DATA_DIR));
}

function tools(): ToolPaths {
  const c = vscode.workspace.getConfiguration("dsaDrill.compilers");
  return { cpp: c.get("cpp"), javac: c.get("javac"), java: c.get("java"), python: c.get("python") };
}

export function activate(ctx: vscode.ExtensionContext) {
  const diagnostics = vscode.languages.createDiagnosticCollection("dsa-drill");
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = "dsaDrill.showResults";
  ctx.subscriptions.push(diagnostics, status);

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

  function showCompileError(file: string, error: string) {
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const m of parseCompileErrors(error)) {
      const f = sameFile(m.file, file) ? file : path.resolve(path.dirname(file), m.file);
      const range = new vscode.Range(m.line - 1, Math.max(0, m.column - 1), m.line - 1, Number.MAX_SAFE_INTEGER);
      const d = new vscode.Diagnostic(range, m.message, m.severity === "warning" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error);
      d.source = "dsa-drill";
      byFile.set(f, [...(byFile.get(f) ?? []), d]);
    }
    for (const [f, ds] of byFile) diagnostics.set(vscode.Uri.file(f), ds);
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
        signal: ac.signal,
        onCase: (r, _i, total) => {
          cases.push(r);
          panel.update({ phase: "running", cases: [...cases], total, passed: cases.filter((c) => c.verdict === "AC").length });
        },
      });
      if (running !== ac) return report; // a newer run took over
      if (report.compileError) {
        showCompileError(file, report.compileError);
        panel.update({ phase: "compileError", compileError: report.compileError, total: report.total, timeLimitMs: report.timeLimitMs });
        setStatus("$(error) Compile error", "Click to see the error", "bad");
      } else {
        const cancelled = ac.signal.aborted;
        panel.update({ phase: cancelled ? "cancelled" : "done", cases: report.cases, total: report.total, passed: report.passed, timeLimitMs: report.timeLimitMs });
        const failed = report.cases.some((c) => c.verdict !== "AC" && c.verdict !== "NO_EXPECTED");
        if (cancelled) setStatus(`$(debug-stop) ${report.passed}/${report.total}`, "Stopped");
        else if (failed) setStatus(`$(error) ${report.passed}/${report.total} passed`, "Click to see which cases failed", "bad");
        else setStatus(`$(pass) ${report.passed}/${report.total} passed`, "All tests passed", "ok");
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
    const r = await runOnInput(file, input, { tools: tools(), timeLimitMs, signal: ac.signal });
    if (customRunning === ac) {
      if ("compileError" in r) {
        showCompileError(file, r.compileError);
        panel.updateCustom({ running: false, compileError: r.compileError });
      } else {
        panel.updateCustom({ running: false, result: r });
      }
      customRunning = undefined;
    }
    return r;
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
    vscode.commands.registerCommand("dsaDrill.stop", () => {
      running?.abort();
      customRunning?.abort();
    }),
    vscode.commands.registerCommand("dsaDrill.showResults", () => panel.show()),
    vscode.languages.registerCodeLensProvider(SELECTOR, {
      onDidChangeCodeLenses: lensEmitter.event,
      provideCodeLenses(doc) {
        if (!vscode.workspace.getConfiguration("dsaDrill").get("codeLens", true)) return [];
        if (!isSolutionFile(doc.uri.fsPath)) return [];
        const top = new vscode.Range(0, 0, 0, 0);
        return [
          new vscode.CodeLens(top, { title: "▶ Run Tests", command: "dsaDrill.runTests", arguments: [doc.uri] }),
          new vscode.CodeLens(top, { title: "Run Custom Input", command: "dsaDrill.runCustomInput", arguments: [doc.uri] }),
        ];
      },
    }),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("dsaDrill") && lensEmitter.fire()),
    vscode.workspace.onDidChangeTextDocument((e) => {
      // compile errors go stale as soon as the file is edited
      if (diagnostics.has(e.document.uri)) diagnostics.delete(e.document.uri);
    }),
  );

  const updateContext = (editor?: vscode.TextEditor) =>
    vscode.commands.executeCommand("setContext", "dsaDrill.activeIsSolution", !!editor && editor.document.uri.scheme === "file" && isSolutionFile(editor.document.uri.fsPath));
  updateContext(vscode.window.activeTextEditor);
  ctx.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateContext));

  const problems = registerProblems(ctx);

  // for the VS Code tests only
  return { _test: { rendered: () => panel.lastRendered, problems: () => problems.snapshot() } };
}

export function deactivate() {}
