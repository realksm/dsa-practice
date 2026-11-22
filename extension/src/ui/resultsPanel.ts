import * as path from "path";
import * as vscode from "vscode";
import { CaseResult } from "../judge";

/** Everything the results view shows. Sent to the webview as one object. */
export interface PanelState {
  file?: string;
  phase: "idle" | "compiling" | "running" | "done" | "compileError" | "cancelled" | "error";
  cases: CaseResult[];
  total: number;
  passed: number;
  timeLimitMs: number;
  compileError?: string;
  error?: string;
  /** A line shown under the header (e.g. what the stress test found). */
  note?: string;
  custom: {
    running: boolean;
    result?: CaseResult;
    compileError?: string;
  };
}

export const emptyState = (): PanelState => ({
  phase: "idle",
  cases: [],
  total: 0,
  passed: 0,
  timeLimitMs: 0,
  note: undefined,
  custom: { running: false },
});

export interface PanelHandlers {
  rerun(): void;
  stop(): void;
  custom(input: string): void;
  openFile(): void;
}

const MAX_TEXT = 20_000;
const clip = (s: string | null | undefined) =>
  s == null ? s : s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + `\n... (${s.length - MAX_TEXT} more characters)` : s;

function clipCase(c: CaseResult): CaseResult {
  return { ...c, input: clip(c.input)!, expected: clip(c.expected) ?? null, output: clip(c.output)!, stderr: clip(c.stderr)! };
}

export class ResultsPanel {
  private panel?: vscode.WebviewPanel;
  private state: PanelState = emptyState();
  private customFocus = false;
  /** Text the webview last drew; used by the VS Code tests. */
  lastRendered?: { header: string; cases: string };

  constructor(private readonly extensionUri: vscode.Uri, private readonly handlers: PanelHandlers) {}

  get current(): PanelState {
    return this.state;
  }

  show(opts: { focusCustomInput?: boolean } = {}) {
    this.customFocus = !!opts.focusCustomInput;
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
      if (this.customFocus) this.panel.webview.postMessage({ type: "focusCustom" });
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      "dsaDrill.results",
      "Test Results",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")] },
    );
    this.panel.webview.html = this.html(this.panel.webview);
    this.panel.onDidDispose(() => (this.panel = undefined));
    this.panel.webview.onDidReceiveMessage((m) => {
      switch (m?.type) {
        case "ready":
          this.post();
          if (this.customFocus) this.panel?.webview.postMessage({ type: "focusCustom" });
          break;
        case "rerun":
          this.handlers.rerun();
          break;
        case "stop":
          this.handlers.stop();
          break;
        case "custom":
          this.handlers.custom(String(m.input ?? ""));
          break;
        case "openFile":
          this.handlers.openFile();
          break;
        case "rendered":
          this.lastRendered = { header: String(m.header ?? ""), cases: String(m.cases ?? "") };
          break;
      }
    });
  }

  update(patch: Partial<PanelState>) {
    this.state = { ...this.state, ...patch };
    this.post();
  }

  updateCustom(patch: Partial<PanelState["custom"]>) {
    this.state = { ...this.state, custom: { ...this.state.custom, ...patch } };
    this.post();
  }

  private post() {
    if (!this.panel) return;
    const s = this.state;
    const view = {
      ...s,
      fileName: s.file ? path.basename(s.file) : undefined,
      cases: s.cases.map(clipCase),
      custom: { ...s.custom, result: s.custom.result && clipCase(s.custom.result) },
    };
    this.panel.webview.postMessage({ type: "state", state: view });
  }

  private html(webview: vscode.Webview): string {
    const nonce = [...Array(32)].map(() => Math.floor(Math.random() * 36).toString(36)).join("");
    const css = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "results.css"));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "results.js"));
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
<title>Test Results</title>
</head>
<body>
<header id="header"></header>
<main id="cases"></main>
<section id="custom">
  <h2>Custom input</h2>
  <textarea id="customInput" rows="5" spellcheck="false" placeholder="Type an input and press Run (Ctrl+Enter)"></textarea>
  <div class="row"><button id="customRun">Run</button><span id="customStatus" class="muted"></span></div>
  <div id="customResult"></div>
</section>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}
