/**
 * Where problems come from: a public GitHub repo (the normal case) or a local folder
 * (for trying problems before pushing them, and for the tests).
 */
import { existsSync, promises as fs } from "fs";
import * as path from "path";
import { buildIndex, INDEX_FILE, ProblemIndex, parseIndex, PROBLEMS_DIR } from "./indexFile";

export const DEFAULT_REPO = "realksm/dsa-practice";

export type RepoSpec = { kind: "github"; owner: string; repo: string; ref?: string } | { kind: "local"; root: string };

/**
 * Accepts "owner/repo", "owner/repo@branch", "https://github.com/owner/repo(.git)",
 * "https://github.com/owner/repo/tree/branch" or an absolute local folder path.
 */
export function parseRepo(value: string): RepoSpec {
  const v = value.trim();
  if (!v) throw new Error("No problems repository set (dsaDrill.repo).");
  if (path.isAbsolute(v) || /^[a-zA-Z]:[\\/]/.test(v) || v.startsWith("~") || v.startsWith(".")) {
    return { kind: "local", root: v.startsWith("~") ? path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", v.slice(1)) : path.resolve(v) };
  }
  const url = v.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/tree\/([^\s#?]+?))?\/?(?:[#?].*)?$/i);
  if (url) return { kind: "github", owner: url[1], repo: url[2], ...(url[3] ? { ref: url[3] } : {}) };
  const short = v.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:@(\S+))?$/);
  if (short) return { kind: "github", owner: short[1], repo: short[2], ...(short[3] ? { ref: short[3] } : {}) };
  throw new Error(`dsaDrill.repo "${v}" is not a GitHub repo (owner/repo or a github.com URL) or a local folder.`);
}

export interface ProblemSource {
  /** Shown to the user, e.g. "realksm/dsa-practice". Also stored with downloaded problems. */
  readonly label: string;
  /** Fetch the index. For GitHub this pins the source to one commit, so later reads match it. */
  loadIndex(): Promise<ProblemIndex>;
  /** Read problems/<slug>/<rel>. */
  readProblemFile(slug: string, rel: string): Promise<Buffer>;
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

const TIMEOUT_MS = 20_000;

export class GitHubSource implements ProblemSource {
  readonly label: string;
  /** The commit (or branch, if the API was unavailable) that reads come from. */
  pinned: string;

  constructor(
    private spec: { owner: string; repo: string; ref?: string },
    private fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  ) {
    this.label = `${spec.owner}/${spec.repo}${spec.ref ? "@" + spec.ref : ""}`;
    this.pinned = spec.ref ?? "HEAD";
  }

  rawUrl(repoPath: string): string {
    const enc = repoPath.split("/").map(encodeURIComponent).join("/");
    return `https://raw.githubusercontent.com/${this.spec.owner}/${this.spec.repo}/${this.pinned}/${enc}`;
  }

  /**
   * Resolve the branch to a commit SHA through the API. raw.githubusercontent.com caches
   * branch URLs for a few minutes after a push; commit URLs are exact. If the API fails
   * (rate limit: 60 calls an hour without a token) fall back to the branch name.
   */
  private async resolveCommit(): Promise<void> {
    const ref = this.spec.ref ?? "HEAD";
    try {
      const r = await this.fetchImpl(`https://api.github.com/repos/${this.spec.owner}/${this.spec.repo}/commits/${encodeURIComponent(ref)}`, {
        headers: { Accept: "application/vnd.github.sha", "User-Agent": "dsa-drill-vscode" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (r.ok) {
        const sha = (await r.text()).trim();
        if (/^[0-9a-f]{40}$/.test(sha)) {
          this.pinned = sha;
          return;
        }
      }
    } catch {
      // offline or blocked: the raw fetch below reports the real problem
    }
    this.pinned = ref;
  }

  private async get(repoPath: string): Promise<Buffer> {
    let r;
    try {
      r = await this.fetchImpl(this.rawUrl(repoPath), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new Error(`Couldn't reach GitHub (${(e as Error).message}). Check your internet connection.`);
    }
    if (r.status === 404) {
      throw Object.assign(new Error(`${repoPath} not found in ${this.label}. Is the repo public, and has it been pushed?`), { notFound: true });
    }
    if (!r.ok) throw new Error(`GitHub returned ${r.status} for ${repoPath}`);
    return Buffer.from(await r.arrayBuffer());
  }

  async loadIndex(): Promise<ProblemIndex> {
    await this.resolveCommit();
    return parseIndex((await this.get(INDEX_FILE)).toString("utf8"));
  }

  readProblemFile(slug: string, rel: string): Promise<Buffer> {
    return this.get(`${PROBLEMS_DIR}/${slug}/${rel}`);
  }
}

export class LocalSource implements ProblemSource {
  readonly label: string;
  constructor(private root: string) {
    this.label = root;
  }

  /** Uses index.json if the folder has one, else builds the index on the fly. */
  async loadIndex(): Promise<ProblemIndex> {
    if (!existsSync(this.root)) throw new Error(`Problems folder ${this.root} doesn't exist.`);
    const file = path.join(this.root, INDEX_FILE);
    if (existsSync(file)) return parseIndex(await fs.readFile(file, "utf8"));
    return (await buildIndex(this.root)).index;
  }

  readProblemFile(slug: string, rel: string): Promise<Buffer> {
    return fs.readFile(path.join(this.root, PROBLEMS_DIR, slug, ...rel.split("/")));
  }
}

export function sourceFor(repoSetting: string, fetchImpl?: FetchLike): ProblemSource {
  const spec = parseRepo(repoSetting);
  return spec.kind === "local" ? new LocalSource(spec.root) : new GitHubSource(spec, fetchImpl);
}
