/** The Problems sidebar and its commands: open (download + starter), refresh, update tests. */
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { LanguageId, LANGUAGES } from "../judge/languages";
import { IndexEntry, ProblemIndex } from "./indexFile";
import { addSolution, InstallResult, installProblem, isOutdated, LocalProblem, scanLocal } from "./install";
import { DEFAULT_REPO, ProblemSource, sourceFor } from "./source";

const DIFFICULTY_ORDER = ["easy", "medium", "hard"];
const LANGS = Object.keys(LANGUAGES) as LanguageId[];

type Node =
  | { kind: "group"; name: string; entries: IndexEntry[] }
  | { kind: "problem"; entry: IndexEntry }
  | { kind: "message"; text: string; icon: string; command?: vscode.Command };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Where problems are downloaded to: the setting, else the first workspace folder. */
function configuredRoot(): string | undefined {
  const setting = vscode.workspace.getConfiguration("dsaDrill").get<string>("workspaceFolder", "").trim();
  const ws = vscode.workspace.workspaceFolders?.find((f) => f.uri.scheme === "file")?.uri.fsPath;
  if (setting) {
    const expanded = setting.startsWith("~") ? path.join(os.homedir(), setting.slice(1)) : setting;
    return path.isAbsolute(expanded) ? expanded : ws ? path.join(ws, expanded) : undefined;
  }
  return ws;
}

export class ProblemsProvider implements vscode.TreeDataProvider<Node> {
  private changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  source?: ProblemSource;
  index?: ProblemIndex;
  local = new Map<string, LocalProblem>();
  error?: { text: string; badSetting?: boolean };
  private loading?: Promise<void>;
  private loadedOnce = false;
  /** Hashes we already told the user about, so a refresh doesn't nag twice. */
  private notified = new Set<string>();

  dispose() {
    this.changed.dispose();
  }

  /** Fetch the index (again). Concurrent calls share one fetch. */
  load(opts: { notify?: boolean } = {}): Promise<void> {
    this.loading ??= (async () => {
      try {
        const repo = vscode.workspace.getConfiguration("dsaDrill").get<string>("repo", DEFAULT_REPO) || DEFAULT_REPO;
        let source: ProblemSource;
        try {
          source = sourceFor(repo);
        } catch (e) {
          this.error = { text: (e as Error).message, badSetting: true };
          return;
        }
        const index = await vscode.window.withProgress({ location: { viewId: "dsaDrill.problems" } }, () => source.loadIndex());
        this.source = source;
        this.index = index;
        this.error = undefined;
        await this.rescan();
        if (opts.notify) this.notifyOutdated();
      } catch (e) {
        this.error = { text: (e as Error).message };
      } finally {
        this.loadedOnce = true;
        this.loading = undefined;
        this.changed.fire(undefined);
      }
    })();
    return this.loading;
  }

  async ensureLoaded(): Promise<ProblemIndex> {
    if (!this.index || this.loading) await this.load();
    if (!this.index) throw new Error(this.error?.text ?? "Couldn't load the problem list.");
    return this.index;
  }

  /** Look at the download folder again (after a download, or files changed). */
  async rescan() {
    const root = configuredRoot();
    this.local = root && this.index ? await scanLocal(root, this.index.problems) : new Map();
    this.changed.fire(undefined);
  }

  outdated(): IndexEntry[] {
    return (this.index?.problems ?? []).filter((e) => isOutdated(e, this.local.get(e.slug)));
  }

  private notifyOutdated() {
    const fresh = this.outdated().filter((e) => !this.notified.has(e.slug + e.hash));
    if (!fresh.length) return;
    fresh.forEach((e) => this.notified.add(e.slug + e.hash));
    const what = fresh.length === 1 ? `"${fresh[0].title}" has` : `${fresh.length} problems have`;
    vscode.window.showInformationMessage(`${what} updated tests. Your solutions won't be touched.`, "Update", "Not now").then((pick) => {
      if (pick === "Update") vscode.commands.executeCommand("dsaDrill.updateAllProblems");
    });
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      if (!this.loadedOnce) {
        void this.load({ notify: true });
        return [];
      }
      if (this.error) {
        return [
          {
            kind: "message",
            text: this.error.text,
            icon: "warning",
            command: this.error.badSetting
              ? { title: "Settings", command: "workbench.action.openSettings", arguments: ["dsaDrill.repo"] }
              : { title: "Retry", command: "dsaDrill.refreshProblems" },
          },
        ];
      }
      const problems = this.index?.problems ?? [];
      if (!problems.length) return [{ kind: "message", text: `No problems in ${this.source?.label} yet.`, icon: "info" }];
      const groups = new Map<string, IndexEntry[]>();
      for (const p of problems) {
        const d = p.difficulty || "unrated";
        groups.set(d, [...(groups.get(d) ?? []), p]);
      }
      const rank = (d: string) => (DIFFICULTY_ORDER.includes(d) ? DIFFICULTY_ORDER.indexOf(d) : d === "unrated" ? 99 : 50);
      return [...groups.entries()]
        .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
        .map(([name, entries]) => ({ kind: "group", name, entries: entries.sort((a, b) => a.title.localeCompare(b.title)) }));
    }
    return node.kind === "group" ? node.entries.map((entry) => ({ kind: "problem", entry })) : [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "message") {
      const item = new vscode.TreeItem(node.text);
      item.iconPath = new vscode.ThemeIcon(node.icon);
      item.tooltip = node.text;
      item.command = node.command;
      return item;
    }
    if (node.kind === "group") {
      const item = new vscode.TreeItem(cap(node.name), vscode.TreeItemCollapsibleState.Expanded);
      item.id = "group:" + node.name;
      item.description = String(node.entries.length);
      return item;
    }
    const e = node.entry;
    const local = this.local.get(e.slug);
    const outdated = isOutdated(e, local);
    const item = new vscode.TreeItem(e.title);
    item.id = "problem:" + e.slug;
    item.description = [...(e.tags ?? []), ...(outdated ? ["tests updated"] : [])].join(" · ");
    item.iconPath = outdated
      ? new vscode.ThemeIcon("cloud-download", new vscode.ThemeColor("notificationsInfoIcon.foreground"))
      : new vscode.ThemeIcon(local ? "file-code" : "circle-large-outline");
    item.contextValue = outdated ? "problem.outdated" : local ? "problem.local" : "problem";
    const tip = new vscode.MarkdownString(`**${e.title}**  \n${cap(e.difficulty || "unrated")}${e.tags?.length ? " · " + e.tags.join(", ") : ""}`);
    tip.appendMarkdown(`  \n${e.files.filter((f) => f.endsWith(".in")).length} tests`);
    if (local) tip.appendMarkdown(`  \nDownloaded to \`${local.dir}\``);
    if (outdated) tip.appendMarkdown("  \nThe tests changed since you downloaded them.");
    item.tooltip = tip;
    item.command = { title: "Open Problem", command: "dsaDrill.openProblem", arguments: [e.slug] };
    return item;
  }

  /** For the VS Code tests: what the tree shows, flattened. */
  snapshot(): ({ slug: string; group: string; local: boolean; outdated: boolean } | { message: string })[] {
    return this.getChildren().flatMap((g): ({ slug: string; group: string; local: boolean; outdated: boolean } | { message: string })[] =>
      g.kind === "group"
        ? g.entries.map((e) => ({ slug: e.slug, group: g.name, local: this.local.has(e.slug), outdated: isOutdated(e, this.local.get(e.slug)) }))
        : [{ message: g.kind === "message" ? g.text : "" }],
    );
  }
}

function slugOf(arg: unknown): string | undefined {
  if (typeof arg === "string") return arg;
  const n = arg as Node | undefined;
  return n?.kind === "problem" ? n.entry.slug : undefined;
}

export function registerProblems(ctx: vscode.ExtensionContext) {
  const provider = new ProblemsProvider();
  const view = vscode.window.createTreeView("dsaDrill.problems", { treeDataProvider: provider, showCollapseAll: true });

  async function entryFor(arg: unknown): Promise<IndexEntry | undefined> {
    const index = await provider.ensureLoaded();
    let slug = slugOf(arg);
    if (!slug) {
      const pick = await vscode.window.showQuickPick(
        index.problems.map((p) => ({ label: p.title, description: [cap(p.difficulty || "unrated"), ...(p.tags ?? [])].join(" · "), slug: p.slug })),
        { placeHolder: "Open which problem?", matchOnDescription: true },
      );
      slug = pick?.slug;
      if (!slug) return;
    }
    const entry = index.problems.find((p) => p.slug === slug);
    if (!entry) throw new Error(`No problem "${slug}" in ${provider.source?.label}. Try refreshing the list.`);
    return entry;
  }

  /** The download folder. Asks for one (and remembers it) if there's no workspace folder. */
  async function downloadRoot(): Promise<string | undefined> {
    const root = configuredRoot();
    if (root) return root;
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      openLabel: "Put problems here",
      title: "Choose a folder for your problems",
    });
    if (!picked?.[0]) return;
    await vscode.workspace.getConfiguration("dsaDrill").update("workspaceFolder", picked[0].fsPath, vscode.ConfigurationTarget.Global);
    return picked[0].fsPath;
  }

  async function pickLanguage(local: LocalProblem | undefined): Promise<LanguageId | undefined> {
    const items = LANGS.map((id) => ({
      label: LANGUAGES[id].name,
      description: LANGUAGES[id].solutionFile + (local?.solutions[id] ? "  (yours, opens as is)" : ""),
      id,
    }));
    return (await vscode.window.showQuickPick(items, { placeHolder: "Which language?" }))?.id;
  }

  /** Statement on the right (rendered), solution on the left with the cursor in it. */
  async function show(result: InstallResult) {
    const md = vscode.Uri.file(path.join(result.dir, "problem.md"));
    await vscode.commands.executeCommand("markdown.showPreviewToSide", md).then(undefined, () =>
      vscode.window.showTextDocument(md, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }),
    );
    if (result.solution) await vscode.window.showTextDocument(vscode.Uri.file(result.solution), { viewColumn: vscode.ViewColumn.One, preview: false });
  }

  /**
   * Open a problem: download it if needed, create the solution file if needed, open both.
   * With no language: reopens your solution if there's exactly one, else asks
   * (dsaDrill.defaultLanguage skips the question for new problems).
   */
  async function openProblem(arg?: unknown, language?: LanguageId, opts: { askLanguage?: boolean } = {}): Promise<InstallResult | undefined> {
    const entry = await entryFor(arg);
    if (!entry || !provider.source) return;
    const root = await downloadRoot();
    if (!root) return;
    const local = provider.local.get(entry.slug);
    if (!language) {
      const existing = LANGS.filter((id) => local?.solutions[id]);
      const preferred = vscode.workspace.getConfiguration("dsaDrill").get<string>("defaultLanguage", "") as LanguageId | "";
      if (!opts.askLanguage && existing.length === 1) language = existing[0];
      else if (!opts.askLanguage && !existing.length && preferred && LANGS.includes(preferred)) language = preferred;
      else language = await pickLanguage(local);
      if (!language) return;
    }
    const source = provider.source;
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Downloading ${entry.title}…` },
      () => (local ? addSolution(source, entry, root, language) : installProblem(source, entry, root, { language })),
    );
    await provider.rescan();
    await show(result);
    if (local && isOutdated(entry, local)) {
      vscode.window.showInformationMessage(`The tests for "${entry.title}" changed since you downloaded them.`, "Update Tests").then((pick) => {
        if (pick) vscode.commands.executeCommand("dsaDrill.updateProblem", entry.slug);
      });
    }
    return result;
  }

  async function update(entries: IndexEntry[]): Promise<number> {
    const root = configuredRoot();
    if (!root || !provider.source) return 0;
    const source = provider.source;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Updating tests…" }, async () => {
      for (const e of entries) await installProblem(source, e, root);
    });
    await provider.rescan();
    return entries.length;
  }

  const guard =
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R | undefined> => {
      try {
        return await fn(...a);
      } catch (e) {
        vscode.window.showErrorMessage(`DSA Drill: ${(e as Error).message}`);
        return undefined;
      }
    };

  ctx.subscriptions.push(
    provider,
    view,
    vscode.commands.registerCommand("dsaDrill.refreshProblems", () => provider.load({ notify: true })),
    vscode.commands.registerCommand(
      "dsaDrill.openProblem",
      guard((arg?: unknown, language?: LanguageId) => openProblem(arg, language)),
    ),
    vscode.commands.registerCommand(
      "dsaDrill.openProblemInLanguage",
      guard((arg?: unknown) => openProblem(arg, undefined, { askLanguage: true })),
    ),
    vscode.commands.registerCommand(
      "dsaDrill.updateProblem",
      guard(async (arg?: unknown) => {
        const entry = await entryFor(arg);
        if (!entry) return 0;
        const n = await update([entry]);
        if (n) vscode.window.showInformationMessage(`Updated the tests for "${entry.title}".`);
        return n;
      }),
    ),
    vscode.commands.registerCommand(
      "dsaDrill.updateAllProblems",
      guard(async () => {
        await provider.ensureLoaded();
        const n = await update(provider.outdated());
        vscode.window.showInformationMessage(n ? `Updated the tests for ${n} problem${n === 1 ? "" : "s"}.` : "All downloaded problems are up to date.");
        return n;
      }),
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("dsaDrill.repo")) void provider.load();
      else if (e.affectsConfiguration("dsaDrill.workspaceFolder")) void provider.rescan();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void provider.rescan()),
  );
  return provider;
}
