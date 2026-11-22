/** Hints for one problem, opened one at a time. The page is rebuilt on every change (it is small). */
import * as vscode from "vscode";
import type { Hint } from "../problems/hints";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface HintsView {
  title: string;
  hints: Hint[];
  shown: number;
}

/** Markdown to HTML with VS Code's own renderer; plain text if that isn't available. */
async function render(md: string): Promise<string> {
  try {
    const html = await vscode.commands.executeCommand<string>("markdown.api.render", md);
    if (typeof html === "string") return html;
  } catch {
    // markdown extension disabled
  }
  return `<pre>${esc(md)}</pre>`;
}

export class HintsPanel {
  private panel?: vscode.WebviewPanel;
  private view?: HintsView;
  /** Text of what was drawn last, for the VS Code tests. */
  lastShown?: { title: string; shown: string[]; total: number };

  constructor(private readonly onAction: (action: "next" | "reset") => void) {}

  async show(view: HintsView) {
    this.view = view;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel("dsaDrill.hints", "Hints", { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true });
      this.panel.onDidDispose(() => (this.panel = undefined));
      this.panel.webview.onDidReceiveMessage((m) => {
        if (m?.type === "next" || m?.type === "reset") this.onAction(m.type);
      });
    } else this.panel.reveal(vscode.ViewColumn.Beside, true);
    await this.draw();
  }

  /** Redraw if the panel shows this problem. */
  async refresh(view: HintsView) {
    if (this.panel && this.view?.title === view.title) {
      this.view = view;
      await this.draw();
    }
  }

  get current(): HintsView | undefined {
    return this.panel ? this.view : undefined;
  }

  private async draw() {
    if (!this.panel || !this.view) return;
    const { title, hints, shown } = this.view;
    const open = hints.slice(0, shown);
    const bodies = await Promise.all(open.map((h) => render(h.body)));
    this.lastShown = { title, shown: open.map((h) => h.title), total: hints.length };
    const nonce = [...Array(32)].map(() => Math.floor(Math.random() * 36).toString(36)).join("");
    const left = hints.length - shown;
    const items = open
      .map((h, i) => `<section class="hint"><h2><span class="n">Hint ${i + 1}</span> ${esc(h.title)}</h2>${bodies[i]}</section>`)
      .join("");
    const next = left
      ? `<button id="next">${shown ? "Show the next hint" : "Show the first hint"}</button> <span class="muted">${shown} of ${hints.length} opened</span>`
      : `<span class="muted">That's every hint (${hints.length}).</span>`;
    const reset = shown ? `<button id="reset" class="secondary">Hide them again</button>` : "";
    this.panel.title = `Hints: ${title}`;
    this.panel.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 8px 18px 24px; line-height: 1.5; max-width: 760px; }
  h1 { font-size: 1.3em; margin: 6px 0 4px; }
  .muted { color: var(--vscode-descriptionForeground); }
  .hint { border-left: 3px solid var(--vscode-textLink-foreground); padding: 2px 0 2px 12px; margin: 16px 0; }
  .hint h2 { font-size: 1.05em; margin: 4px 0 6px; }
  .hint .n { color: var(--vscode-descriptionForeground); font-weight: 400; margin-right: 4px; }
  code, pre { font-family: var(--vscode-editor-font-family); }
  pre { background: var(--vscode-textCodeBlock-background); padding: 8px 10px; border-radius: 4px; overflow-x: auto; }
  .actions { display: flex; gap: 10px; align-items: center; margin-top: 18px; flex-wrap: wrap; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 5px 12px; border-radius: 2px; cursor: pointer; font: inherit; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
</style><title>Hints</title></head><body>
<h1>${esc(title)}</h1>
<p class="muted">${shown ? "Try the problem again with what you have before opening another." : `${hints.length} hint${hints.length === 1 ? "" : "s"}, from a gentle nudge to the key idea. Open them one at a time.`}</p>
${items}
<div class="actions">${next}${reset}</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  for (const id of ["next", "reset"]) document.getElementById(id)?.addEventListener("click", () => vscode.postMessage({ type: id }));
</script></body></html>`;
  }

  dispose() {
    this.panel?.dispose();
  }
}
