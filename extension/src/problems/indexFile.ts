/**
 * index.json: the list of problems the extension shows in its sidebar.
 * Generated from problems/<slug>/ by buildIndex() (npm run index), never written by hand.
 */
import { createHash } from "crypto";
import { promises as fs } from "fs";
import * as path from "path";
import { DATA_DIR } from "../judge/tests";
import { HINTS_FILE, parseHints } from "./hints";

export const INDEX_FILE = "index.json";
export const PROBLEMS_DIR = "problems";
export const STARTERS_DIR = "starters";
export const INDEX_VERSION = 1;

export interface IndexEntry {
  slug: string;
  title: string;
  difficulty?: string;
  tags?: string[];
  /** Files of the problem, relative to problems/<slug>/, with "/" separators. */
  files: string[];
  /** Content hash of everything except starters/. Changes when the statement, meta or tests change. */
  hash: string;
  /** How many hints hints.md has (it is fetched when asked for, never downloaded or hashed). */
  hints?: number;
}

export interface ProblemIndex {
  version: number;
  problems: IndexEntry[];
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

export function isValidSlug(slug: string): boolean {
  return SLUG.test(slug);
}

/** A file path from index.json is safe to write if it stays inside the problem folder. */
export function isSafeRelPath(rel: string): boolean {
  if (!rel || rel.includes("\\") || rel.startsWith("/") || /^[a-zA-Z]:/.test(rel)) return false;
  return rel.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

export const isStarter = (rel: string) => rel.startsWith(STARTERS_DIR + "/");

/** index.json as written to disk. Everything that writes or checks the file uses this. */
export function indexText(index: ProblemIndex): string {
  return JSON.stringify(index, null, 2) + "\n";
}

/** Check the shape of a downloaded index.json. Throws with a readable message. */
export function parseIndex(text: string): ProblemIndex {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`index.json is not valid JSON: ${(e as Error).message}`);
  }
  const idx = data as ProblemIndex;
  if (!idx || typeof idx !== "object" || !Array.isArray(idx.problems)) throw new Error("index.json has no problems list");
  if (typeof idx.version === "number" && idx.version > INDEX_VERSION) {
    throw new Error(`index.json is version ${idx.version}; this extension understands version ${INDEX_VERSION}. Update the extension.`);
  }
  for (const p of idx.problems) {
    if (!p || typeof p.slug !== "string" || !isValidSlug(p.slug)) throw new Error(`index.json has a bad slug: ${JSON.stringify(p?.slug)}`);
    if (!Array.isArray(p.files) || !p.files.every((f) => typeof f === "string" && isSafeRelPath(f))) {
      throw new Error(`index.json lists a bad file path for ${p.slug}`);
    }
    if (typeof p.hash !== "string") throw new Error(`index.json has no hash for ${p.slug}`);
    if (typeof p.title !== "string") p.title = p.slug;
    if (p.hints !== undefined && !(Number.isInteger(p.hints) && p.hints > 0)) delete p.hints;
  }
  return idx;
}

/**
 * Hash of a problem's files. Line endings are normalised to \n first, so a checkout with
 * CRLF (Windows, core.autocrlf) gives the same hash as Linux CI.
 */
export function hashFiles(files: { rel: string; content: Buffer }[]): string {
  const h = createHash("sha256");
  for (const f of [...files].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))) {
    h.update(f.rel + "\0");
    h.update(f.content.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
    h.update("\0");
  }
  return h.digest("hex").slice(0, 16);
}

async function listFiles(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(path.join(dir, e.name), rel)));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

export interface BuildResult {
  index: ProblemIndex;
  /** Problem folders that were left out, and why. */
  skipped: { slug: string; reason: string }[];
  /** Problems that were included but look wrong. */
  warnings: { slug: string; message: string }[];
}

/**
 * Build the index from <repoRoot>/problems/. A folder needs problem.md, meta.json and .data/
 * with at least one .in file; others are skipped (old-layout folders, work in progress).
 */
export async function buildIndex(repoRoot: string): Promise<BuildResult> {
  const problemsDir = path.join(repoRoot, PROBLEMS_DIR);
  const result: BuildResult = { index: { version: INDEX_VERSION, problems: [] }, skipped: [], warnings: [] };
  let dirs: string[];
  try {
    dirs = (await fs.readdir(problemsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    throw new Error(`No ${PROBLEMS_DIR}/ folder in ${repoRoot}`);
  }
  for (const slug of dirs.sort()) {
    const dir = path.join(problemsDir, slug);
    if (!isValidSlug(slug)) {
      result.skipped.push({ slug, reason: "folder name must be lowercase letters, digits and dashes" });
      continue;
    }
    const all = await listFiles(dir);
    const missing = ["problem.md", "meta.json"].filter((f) => !all.includes(f));
    const ins = all.filter((f) => f.startsWith(DATA_DIR + "/") && f.toLowerCase().endsWith(".in"));
    if (missing.length || !ins.length) {
      const why = [...missing, ...(ins.length ? [] : [`${DATA_DIR}/*.in`])];
      result.skipped.push({ slug, reason: `missing ${why.join(", ")}` });
      continue;
    }
    let meta: { title?: string; difficulty?: string; tags?: string[] };
    try {
      meta = JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf8"));
    } catch (e) {
      result.skipped.push({ slug, reason: `meta.json is not valid JSON: ${(e as Error).message}` });
      continue;
    }
    const files = all.filter((f) => f === "problem.md" || f === "meta.json" || f.startsWith(DATA_DIR + "/") || isStarter(f)).sort();
    for (const inFile of ins) {
      const base = inFile.slice(0, -3);
      if (!files.includes(base + ".out") && !files.includes(base + ".ans")) {
        result.warnings.push({ slug, message: `${inFile} has no expected output (.out)` });
      }
    }
    if (!meta.title) result.warnings.push({ slug, message: "meta.json has no title" });
    const hints = all.includes(HINTS_FILE) ? parseHints(await fs.readFile(path.join(dir, HINTS_FILE), "utf8")).length : 0;
    if (all.includes(HINTS_FILE) && !hints) result.warnings.push({ slug, message: `${HINTS_FILE} has no "## " hint headings` });
    const hashed = await Promise.all(
      files.filter((f) => !isStarter(f)).map(async (rel) => ({ rel, content: await fs.readFile(path.join(dir, rel)) })),
    );
    result.index.problems.push({
      slug,
      title: meta.title || slug,
      ...(meta.difficulty ? { difficulty: String(meta.difficulty).toLowerCase() } : {}),
      ...(Array.isArray(meta.tags) && meta.tags.length ? { tags: meta.tags.map(String) } : {}),
      files,
      hash: hashFiles(hashed),
      ...(hints ? { hints } : {}),
    });
  }
  return result;
}
