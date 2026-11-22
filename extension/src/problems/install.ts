/**
 * Download a problem into the user's folder, and update its tests later.
 *
 *   <dest>/<slug>/problem.md
 *   <dest>/<slug>/meta.json
 *   <dest>/<slug>/.data/01.in 01.out ... .source.json
 *   <dest>/<slug>/solution.cpp            (only created if missing; never overwritten)
 */
import { existsSync, promises as fs } from "fs";
import * as path from "path";
import { LanguageId, LANGUAGES } from "../judge/languages";
import { DATA_DIR } from "../judge/tests";
import { IndexEntry, isSafeRelPath, isStarter, STARTERS_DIR } from "./indexFile";
import type { ProblemSource } from "./source";
import { BUILTIN_STARTERS } from "./starters";

/** Written into .data/ so we know which version of the tests the user has. */
export const SOURCE_INFO = ".source.json";

export interface SourceInfo {
  slug: string;
  hash: string;
  repo: string;
}

export interface LocalProblem {
  dir: string;
  /** Hash of the tests the user has; undefined if the folder wasn't made by the extension. */
  hash?: string;
  /** Solution files that exist, by language. */
  solutions: Partial<Record<LanguageId, string>>;
}

export async function readSourceInfo(problemDir: string): Promise<SourceInfo | undefined> {
  try {
    return JSON.parse(await fs.readFile(path.join(problemDir, DATA_DIR, SOURCE_INFO), "utf8"));
  } catch {
    return undefined;
  }
}

export function solutionsIn(problemDir: string): Partial<Record<LanguageId, string>> {
  const out: Partial<Record<LanguageId, string>> = {};
  for (const id of Object.keys(LANGUAGES) as LanguageId[]) {
    const f = path.join(problemDir, LANGUAGES[id].solutionFile);
    if (existsSync(f)) out[id] = f;
  }
  return out;
}

/** Which of the indexed problems are already in destRoot. */
export async function scanLocal(destRoot: string, entries: IndexEntry[]): Promise<Map<string, LocalProblem>> {
  const found = new Map<string, LocalProblem>();
  await Promise.all(
    entries.map(async (e) => {
      const dir = path.join(destRoot, e.slug);
      if (!existsSync(path.join(dir, DATA_DIR))) return;
      found.set(e.slug, { dir, hash: (await readSourceInfo(dir))?.hash, solutions: solutionsIn(dir) });
    }),
  );
  return found;
}

export const isOutdated = (entry: IndexEntry, local: LocalProblem | undefined) => !!local && local.hash !== entry.hash;

/** Run fn over items, at most `limit` at a time. */
async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export interface InstallResult {
  dir: string;
  /** The solution file for the requested language, if one was requested. */
  solution?: string;
  /** True if the solution file was created now (false: it already existed and was left alone). */
  createdSolution: boolean;
}

/**
 * Download (or update) a problem. Everything is fetched before anything is written, so a
 * network failure leaves an existing copy as it was. The statement, meta.json and .data/ are
 * replaced; solution files and anything else in the folder are never touched.
 * With `language`, also creates that language's solution file if it doesn't exist.
 */
export async function installProblem(
  source: ProblemSource,
  entry: IndexEntry,
  destRoot: string,
  opts: { language?: LanguageId } = {},
): Promise<InstallResult> {
  const files = entry.files.filter((f) => !isStarter(f));
  for (const f of entry.files) if (!isSafeRelPath(f)) throw new Error(`Refusing to write ${f}: unsafe path`);
  const contents = await pool(files, 8, (rel) => source.readProblemFile(entry.slug, rel));

  const dir = path.join(destRoot, entry.slug);
  const starter = opts.language ? await fetchStarter(source, entry, dir, opts.language) : undefined;

  await fs.mkdir(dir, { recursive: true });
  // new .data goes into a side folder first, then replaces the old one in one step
  const dataNew = path.join(dir, `${DATA_DIR}.new-${process.pid}-${Date.now()}`);
  await fs.mkdir(dataNew, { recursive: true });
  try {
    for (let i = 0; i < files.length; i++) {
      const rel = files[i];
      const inData = rel.startsWith(DATA_DIR + "/");
      const target = inData ? path.join(dataNew, ...rel.slice(DATA_DIR.length + 1).split("/")) : path.join(dir, ...rel.split("/"));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, contents[i]);
    }
    const info: SourceInfo = { slug: entry.slug, hash: entry.hash, repo: source.label };
    await fs.writeFile(path.join(dataNew, SOURCE_INFO), JSON.stringify(info, null, 2) + "\n");
    await fs.rm(path.join(dir, DATA_DIR), { recursive: true, force: true });
    await fs.rename(dataNew, path.join(dir, DATA_DIR));
  } catch (e) {
    await fs.rm(dataNew, { recursive: true, force: true });
    throw e;
  }

  if (!opts.language) return { dir, createdSolution: false };
  return { dir, ...(await writeStarter(dir, opts.language, starter)) };
}

/** The starter text: the problem's own starters/<file> if it has one, else the built-in template. Undefined if the solution exists. */
async function fetchStarter(source: ProblemSource, entry: IndexEntry, dir: string, language: LanguageId): Promise<Buffer | string | undefined> {
  const file = LANGUAGES[language].solutionFile;
  if (existsSync(path.join(dir, file))) return undefined;
  const own = `${STARTERS_DIR}/${file}`;
  return entry.files.includes(own) ? source.readProblemFile(entry.slug, own) : BUILTIN_STARTERS[language];
}

async function writeStarter(dir: string, language: LanguageId, starter: Buffer | string | undefined) {
  const solution = path.join(dir, LANGUAGES[language].solutionFile);
  if (starter === undefined) return { solution, createdSolution: false };
  try {
    // "wx" fails if the file appeared in the meantime: never overwrite a solution
    await fs.writeFile(solution, starter, { flag: "wx" });
    return { solution, createdSolution: true };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return { solution, createdSolution: false };
    throw e;
  }
}

/** Add a solution file in another language to a problem that is already downloaded. Leaves the tests alone. */
export async function addSolution(source: ProblemSource, entry: IndexEntry, destRoot: string, language: LanguageId): Promise<InstallResult> {
  const dir = path.join(destRoot, entry.slug);
  return { dir, ...(await writeStarter(dir, language, await fetchStarter(source, entry, dir, language))) };
}
