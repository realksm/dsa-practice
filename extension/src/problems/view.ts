/** The Problems sidebar and its commands: open (download + starter), refresh, update tests, filter, solved. */
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { LanguageId, LANGUAGES } from "../judge/languages";
import { applyFilter, describeFilter, FILTER_KEY, isFilterActive, NO_FILTER, normaliseFilter, ProblemFilter, tagCounts } from "./filter";
import { IndexEntry, ProblemIndex } from "./indexFile";
import { addSolution, InstallResult, installProblem, isOutdated, LocalProblem, scanLocal } from "./install";
import { Hint, HINTS_FILE, HintStore, parseHints } from "./hints";
import { describeRun, HistoryStore } from "./history";
import { readSourceInfo } from "./install";
import { ActivityStore, computeStats, dayKey } from "./stats";
import { HintsPanel } from "../ui/hintsPanel";
import { StatsPanel } from "../ui/statsPanel";
import { SolvedRecord, SolvedStore, StateStore } from "./solved";
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
  filter: ProblemFilter;

  constructor(
    readonly solved: SolvedStore,
    private readonly state: StateStore,
    readonly history?: HistoryStore,
    readonly hintStore?: HintStore,
  ) {
    this.filter = normaliseFilter(state.get(FILTER_KEY, NO_FILTER));
  }

  dispose() {
    this.changed.dispose();
  }

  refresh() {
    this.changed.fire(undefined);
  }

  solvedRecord(slug: string): SolvedRecord | undefined {
    return this.source ? this.solved.get(this.source.label, slug) : undefined;
  }

  isSolved = (slug: string) => !!this.solvedRecord(slug);

  async setFilter(f: ProblemFilter) {
    this.filter = normaliseFilter(f);
    await this.state.update(FILTER_KEY, this.filter);
    this.refresh();
  }

  /** "1/2 solved", for the view title. */
  solvedSummary(): string | undefined {
    const all = this.index?.problems ?? [];
    return all.length ? `${all.filter((e) => this.isSolved(e.slug)).length}/${all.length} solved` : undefined;
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
      const shown = applyFilter(problems, this.filter, this.isSolved);
      if (!shown.length) {
        return [{ kind: "message", text: "No problems match the filter.", icon: "filter", command: { title: "Clear Filter", command: "dsaDrill.clearFilter" } }];
      }
      const groups = new Map<string, IndexEntry[]>();
      for (const p of shown) {
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
      const solved = node.entries.filter((e) => this.isSolved(e.slug)).length;
      item.description = solved ? `${solved}/${node.entries.length}` : String(node.entries.length);
      return item;
    }
    const e = node.entry;
    const local = this.local.get(e.slug);
    const outdated = isOutdated(e, local);
    const solved = this.solvedRecord(e.slug);
    const item = new vscode.TreeItem(e.title);
    item.id = "problem:" + e.slug;
    const best = this.source && this.history?.best(this.source.label, e.slug, e.hash);
    const runs = this.source && this.history ? this.history.runs(this.source.label, e.slug) : [];
    item.description = [...(e.tags ?? []), ...(best ? [`${best.maxTimeMs} ms`] : []), ...(outdated ? ["tests updated"] : [])].join(" · ");
    item.iconPath = outdated
      ? new vscode.ThemeIcon("cloud-download", new vscode.ThemeColor("notificationsInfoIcon.foreground"))
      : solved
        ? new vscode.ThemeIcon("pass-filled", new vscode.ThemeColor("testing.iconPassed"))
        : new vscode.ThemeIcon(local ? "file-code" : "circle-large-outline");
    // contextValue is "problem", "problem.local" or "problem.outdated", then ".solved", then ".hints" (see package.json menus)
    item.contextValue = (outdated ? "problem.outdated" : local ? "problem.local" : "problem") + (solved ? ".solved" : "") + (e.hints ? ".hints" : "");
    const tip = new vscode.MarkdownString(`**${e.title}**  \n${cap(e.difficulty || "unrated")}${e.tags?.length ? " · " + e.tags.join(", ") : ""}`);
    tip.appendMarkdown(`  \n${e.files.filter((f) => f.endsWith(".in")).length} tests`);
    if (solved) {
      const langs = solved.languages.map((l) => LANGUAGES[l]?.name ?? l).join(", ");
      tip.appendMarkdown(`  \n✓ Solved in ${langs} (first on ${solved.firstAt.slice(0, 10)})`);
      if (solved.hash && solved.hash !== e.hash) tip.appendMarkdown(" — the tests have changed since");
    }
    if (best) tip.appendMarkdown(`  \nBest: ${best.maxTimeMs} ms slowest case (${LANGUAGES[best.language]?.name ?? best.language}, ${best.at.slice(0, 10)})`);
    if (runs[0]) tip.appendMarkdown(`  \nLast run: ${describeRun(runs[0])} (${runs[0].at.slice(0, 10)}) · ${runs.length} run${runs.length === 1 ? "" : "s"} kept`);
    if (e.hints) {
      const opened = this.source && this.hintStore ? this.hintStore.shown(this.source.label, e.slug) : 0;
      tip.appendMarkdown(`  \n${e.hints} hint${e.hints === 1 ? "" : "s"}${opened ? ` (${Math.min(opened, e.hints)} opened)` : ""}: right-click → Show Hints`);
    }
    if (local) tip.appendMarkdown(`  \nDownloaded to \`${local.dir}\``);
    if (outdated) tip.appendMarkdown("  \nThe tests changed since you downloaded them.");
    item.tooltip = tip;
    item.command = { title: "Open Problem", command: "dsaDrill.openProblem", arguments: [e.slug] };
    return item;
  }

  /** For the VS Code tests: what the tree shows, flattened. */
  snapshot(): (SnapshotRow | { message: string })[] {
    return this.getChildren().flatMap((g): (SnapshotRow | { message: string })[] =>
      g.kind === "group"
        ? g.entries.map((e) => ({
            slug: e.slug,
            group: g.name,
            local: this.local.has(e.slug),
            outdated: isOutdated(e, this.local.get(e.slug)),
            solved: this.isSolved(e.slug),
          }))
        : [{ message: g.kind === "message" ? g.text : "" }],
    );
  }
}

type SnapshotRow = { slug: string; group: string; local: boolean; outdated: boolean; solved: boolean };

/** Ask which tags to show and whether to hide solved problems. Undefined = cancelled. */
async function pickFilter(index: ProblemIndex, current: ProblemFilter): Promise<ProblemFilter | undefined> {
  type Item = vscode.QuickPickItem & { tag?: string; hideSolved?: boolean };
  const hide: Item = { label: "$(pass-filled) Hide solved problems", hideSolved: true, picked: current.hideSolved };
  const tags = tagCounts(index.problems);
  const items: Item[] = [
    hide,
    { label: "Tags: show problems with any of the checked tags", kind: vscode.QuickPickItemKind.Separator },
    ...tags.map((t) => ({ label: t.tag, description: `${t.count} problem${t.count === 1 ? "" : "s"}`, tag: t.tag, picked: current.tags.includes(t.tag) })),
  ];
  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: "Filter Problems",
    placeHolder: tags.length ? "Check tags to narrow the list. Nothing checked shows everything." : "No problem has tags yet.",
  });
  if (!picked) return undefined;
  return { tags: picked.flatMap((p) => (p.tag ? [p.tag] : [])), hideSolved: picked.some((p) => p.hideSolved) };
}

function slugOf(arg: unknown): string | undefined {
  if (typeof arg === "string") return arg;
  const n = arg as Node | undefined;
  return n?.kind === "problem" ? n.entry.slug : undefined;
}

export function registerProblems(ctx: vscode.ExtensionContext, solved: SolvedStore, history: HistoryStore, activity: ActivityStore) {
  const hintStore = new HintStore(ctx.globalState);
  const provider = new ProblemsProvider(solved, ctx.globalState, history, hintStore);
  const view = vscode.window.createTreeView("dsaDrill.problems", { treeDataProvider: provider, showCollapseAll: true });

  /** The view's title count, filter line and the context key that swaps the filter buttons. */
  const updateChrome = () => {
    view.description = provider.solvedSummary();
    view.message = describeFilter(provider.filter);
    void vscode.commands.executeCommand("setContext", "dsaDrill.filterActive", isFilterActive(provider.filter));
  };
  updateChrome();

  async function entryFor(arg: unknown): Promise<IndexEntry | undefined> {
    const index = await provider.ensureLoaded();
    let slug = slugOf(arg);
    if (!slug) {
      const pick = await vscode.window.showQuickPick(
        index.problems.map((p) => ({
          label: (provider.isSolved(p.slug) ? "$(pass-filled) " : "") + p.title,
          description: [cap(p.difficulty || "unrated"), ...(p.tags ?? []), ...(provider.isSolved(p.slug) ? ["solved"] : [])].join(" · "),
          slug: p.slug,
        })),
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
    // The solution first: "to the side" is beside the active editor, and with no editor open
    // (a fresh window) the statement would otherwise land in the same group as the solution.
    const sol = result.solution ? vscode.Uri.file(result.solution) : undefined;
    if (sol) await vscode.window.showTextDocument(sol, { viewColumn: vscode.ViewColumn.One, preview: false });
    await vscode.commands.executeCommand("markdown.showPreviewToSide", md).then(undefined, () =>
      vscode.window.showTextDocument(md, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }),
    );
    if (sol) await vscode.window.showTextDocument(sol, { viewColumn: vscode.ViewColumn.One, preview: false });
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

  // ---- hints ----

  /** hints.md is fetched when asked for (never downloaded); kept per test hash for the session. */
  const hintCache = new Map<string, Promise<Hint[]>>();
  function hintsFor(entry: IndexEntry): Promise<Hint[]> {
    const source = provider.source!;
    const key = `${source.label}::${entry.slug}::${entry.hash}`;
    let p = hintCache.get(key);
    if (!p) {
      p = source.readProblemFile(entry.slug, HINTS_FILE).then((b) => parseHints(b.toString("utf8")));
      p.catch(() => hintCache.delete(key)); // offline now: try again next time
      hintCache.set(key, p);
    }
    return p;
  }

  let hintsOpen: { entry: IndexEntry; hints: Hint[] } | undefined;
  const hintsView = () => hintsOpen && { title: hintsOpen.entry.title, hints: hintsOpen.hints, shown: Math.min(hintStore.shown(provider.source!.label, hintsOpen.entry.slug), hintsOpen.hints.length) };
  async function hintAction(action: "next" | "reset") {
    if (!hintsOpen || !provider.source) return;
    const { entry, hints } = hintsOpen;
    const shown = hintStore.shown(provider.source.label, entry.slug);
    await hintStore.setShown(provider.source.label, entry.slug, action === "next" ? Math.min(shown + 1, hints.length) : 0);
    await hintsPanel.refresh(hintsView()!);
    provider.refresh();
  }
  const hintsPanel = new HintsPanel((action) => void hintAction(action));

  /** The problem of the active solution file, if it was downloaded from the current repo. */
  async function activeEntry(): Promise<IndexEntry | undefined> {
    const doc = vscode.window.activeTextEditor?.document;
    if (!doc || doc.uri.scheme !== "file") return;
    const info = await readSourceInfo(path.dirname(doc.uri.fsPath));
    if (!info?.slug || info.repo !== provider.source?.label) return;
    return provider.index?.problems.find((p) => p.slug === info.slug);
  }

  async function showHints(arg?: unknown) {
    const index = await provider.ensureLoaded();
    let entry = slugOf(arg) ? await entryFor(arg) : await activeEntry();
    if (!entry) {
      const withHints = index.problems.filter((p) => p.hints);
      if (!withHints.length) {
        vscode.window.showInformationMessage(`No problem in ${provider.source?.label} has hints yet.`);
        return;
      }
      const pick = await vscode.window.showQuickPick(
        withHints.map((p) => ({ label: p.title, description: `${p.hints} hint${p.hints === 1 ? "" : "s"}`, entry: p })),
        { placeHolder: "Hints for which problem?", matchOnDescription: true },
      );
      entry = pick?.entry;
      if (!entry) return;
    }
    if (!entry.hints) {
      vscode.window.showInformationMessage(`"${entry.title}" has no hints.`);
      return;
    }
    const hints = await vscode.window.withProgress({ location: { viewId: "dsaDrill.problems" } }, () => hintsFor(entry!));
    if (!hints.length) {
      vscode.window.showInformationMessage(`"${entry.title}" has no hints.`);
      return;
    }
    hintsOpen = { entry, hints };
    await hintsPanel.show(hintsView()!);
    return hintsPanel.lastShown;
  }

  // ---- stats ----

  const statsPanel = new StatsPanel(ctx.extensionUri);
  const stats = () => computeStats(provider.index?.problems ?? [], (slug) => provider.solvedRecord(slug), activity.days());
  async function showStats() {
    await provider.ensureLoaded();
    statsPanel.show(stats(), provider.source?.label ?? "", dayKey(new Date()));
    return stats();
  }
  const refreshStats = () => statsPanel.visible && statsPanel.update(stats(), provider.source?.label ?? "", dayKey(new Date()));

  ctx.subscriptions.push(
    hintsPanel,
    statsPanel,
    solved.onDidChange(refreshStats),
    history.onDidChange(refreshStats),
    provider.onDidChangeTreeData(refreshStats),
    vscode.commands.registerCommand("dsaDrill.showHints", guard(showHints)),
    // what the hints panel's buttons do; not in package.json (the VS Code tests call it)
    vscode.commands.registerCommand("dsaDrill.hintAction", async (action: "next" | "reset") => {
      await hintAction(action);
      return hintsPanel.lastShown;
    }),
    vscode.commands.registerCommand("dsaDrill.showStats", guard(showStats)),
  );

  ctx.subscriptions.push(
    provider,
    view,
    provider.onDidChangeTreeData(updateChrome),
    solved.onDidChange(() => provider.refresh()),
    history.onDidChange(() => provider.refresh()),
    vscode.commands.registerCommand(
      "dsaDrill.showHistory",
      guard(async (arg?: unknown) => {
        const entry = await entryFor(arg);
        if (!entry || !provider.source) return;
        const runs = history.runs(provider.source.label, entry.slug);
        if (!runs.length) {
          vscode.window.showInformationMessage(`No runs of "${entry.title}" yet. Each Run Tests is recorded here.`);
          return runs;
        }
        const best = history.best(provider.source.label, entry.slug, entry.hash);
        void vscode.window.showQuickPick(
          runs.map((r) => ({
            label: `${r.verdict === "AC" ? "$(pass-filled)" : "$(error)"} ${describeRun(r)}${r === best ? "  $(star-full) best" : ""}`,
            description: `${LANGUAGES[r.language]?.name ?? r.language} · ${new Date(r.at).toLocaleString()}`,
            detail: r.hash && r.hash !== entry.hash ? "against older tests" : undefined,
          })),
          { title: `Run history: ${entry.title}`, placeHolder: `${runs.length} most recent run${runs.length === 1 ? "" : "s"}, newest first` },
        );
        return runs;
      }),
    ),
    vscode.commands.registerCommand("dsaDrill.refreshProblems", () => provider.load({ notify: true })),
    vscode.commands.registerCommand(
      "dsaDrill.filterProblems",
      guard(async (f?: ProblemFilter) => {
        const index = await provider.ensureLoaded();
        const next = f ?? (await pickFilter(index, provider.filter));
        if (next) await provider.setFilter(next);
        return provider.filter;
      }),
    ),
    vscode.commands.registerCommand("dsaDrill.clearFilter", () => provider.setFilter(NO_FILTER)),
    vscode.commands.registerCommand(
      "dsaDrill.markUnsolved",
      guard(async (arg?: unknown) => {
        const entry = await entryFor(arg);
        if (entry && provider.source) await solved.unmark(provider.source.label, entry.slug);
      }),
    ),
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
