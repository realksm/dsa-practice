/** Paths and checks shared by the authoring scripts (new, build, check). */
import { promises as fs } from "fs";
import * as path from "path";
import { CHECKER_STEM } from "../extension/src/judge/checker";
import { languageOf } from "../extension/src/judge/languages";
import { DATA_DIR, type ProblemMeta } from "../extension/src/judge/tests";
import { HINTS_FILE, parseHints } from "../extension/src/problems/hints";
import { isValidSlug, PROBLEMS_DIR } from "../extension/src/problems/indexFile";

/** Compiled scripts live in authoring/out/authoring/, so the repo root is three levels up. */
export const ROOT = path.resolve(__dirname, "../../..");
export const PROBLEMS = path.join(ROOT, PROBLEMS_DIR);
export const REFERENCES = path.join(ROOT, "references");

export const DIFFICULTIES = ["easy", "medium", "hard"];

/** Files from the old judge.py layout that must not end up in a published problem. */
const OLD_LAYOUT = /^(tests\.txt|naive\.\w+|brute\.\w+|gen\.\w+|ref\.\w+|solution\.\w+|Main\.java)$/;

export async function exists(p: string): Promise<boolean> {
  return fs.stat(p).then(
    () => true,
    () => false,
  );
}

export async function problemSlugs(): Promise<string[]> {
  const dirs = await fs.readdir(PROBLEMS, { withFileTypes: true });
  return dirs.filter((d) => d.isDirectory()).map((d) => d.name).sort();
}

/** "two-sum" -> "Two Sum" */
export function titleFromSlug(slug: string): string {
  return slug.split("-").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

/** Natural order, so 2.in comes before 10.in. */
export const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/**
 * Everything that is wrong with problems/<slug>, as readable messages. Empty = publishable.
 * Needs no compilers, so CI can run it.
 */
export async function validateProblem(slug: string): Promise<string[]> {
  const dir = path.join(PROBLEMS, slug);
  const errors: string[] = [];
  if (!isValidSlug(slug)) errors.push("folder name must be lowercase letters, digits and dashes");

  const top = await fs.readdir(dir);
  for (const f of ["problem.md", "meta.json"]) if (!top.includes(f)) errors.push(`missing ${f}`);
  for (const f of top) {
    if (OLD_LAYOUT.test(f)) errors.push(`${f} does not belong here (references go in references/${slug}/, starters in starters/)`);
  }

  if (top.includes("problem.md")) {
    const md = (await fs.readFile(path.join(dir, "problem.md"), "utf8")).trim();
    if (!md) errors.push("problem.md is empty");
    if (md.includes("TODO")) errors.push("problem.md still contains TODO");
  }

  if (top.includes("meta.json")) {
    let meta: ProblemMeta | undefined;
    try {
      meta = JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf8"));
    } catch (e) {
      errors.push(`meta.json is not valid JSON: ${(e as Error).message}`);
    }
    if (meta) errors.push(...validateMeta(meta).map((m) => `meta.json: ${m}`));
  }

  if (top.includes(HINTS_FILE)) {
    const text = await fs.readFile(path.join(dir, HINTS_FILE), "utf8");
    const hints = parseHints(text);
    if (!hints.length) errors.push(`${HINTS_FILE} has no hints: start each one with a "## " heading`);
    if (hints.some((h) => !h.body)) errors.push(`${HINTS_FILE} has a hint with nothing under its heading`);
    if (text.includes("TODO")) errors.push(`${HINTS_FILE} still contains TODO`);
  }

  const dataDir = path.join(dir, DATA_DIR);
  const data = (await exists(dataDir)) ? await fs.readdir(dataDir) : [];
  const ins = data.filter((f) => f.endsWith(".in"));
  if (!ins.length) errors.push(`no ${DATA_DIR}/*.in tests`);
  for (const f of ins) {
    const stem = f.slice(0, -3);
    if (!data.includes(stem + ".out")) errors.push(`${DATA_DIR}/${f} has no ${stem}.out (run npm run build)`);
    if (!(await fs.readFile(path.join(dataDir, f), "utf8")).trim()) errors.push(`${DATA_DIR}/${f} is empty`);
  }
  const checkers = data.filter(isCheckerFile);
  if (checkers.length > 1) errors.push(`${DATA_DIR}/ has several checkers (${checkers.join(", ")}); keep one`);
  for (const f of checkers) {
    if ((await fs.readFile(path.join(dataDir, f), "utf8")).includes("TODO")) errors.push(`${DATA_DIR}/${f} still contains TODO`);
  }
  for (const f of data) {
    if (f.endsWith(".out") && !data.includes(f.slice(0, -4) + ".in")) errors.push(`${DATA_DIR}/${f} has no matching .in`);
    else if (!f.endsWith(".in") && !f.endsWith(".out") && !isCheckerFile(f)) {
      errors.push(`${DATA_DIR}/${f}: only .in and .out files (and a checker.cpp / checker.py) go in ${DATA_DIR}/`);
    }
  }
  return errors;
}

/** .data/checker.cpp, checker.py or checker.java. */
export const isCheckerFile = (f: string) => path.parse(f).name.toLowerCase() === CHECKER_STEM && !!languageOf(f);

export function validateMeta(meta: ProblemMeta): string[] {
  const errors: string[] = [];
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return ["must be a JSON object"];
  if (typeof meta.title !== "string" || !meta.title.trim()) errors.push("title must be a non-empty string");
  if (!DIFFICULTIES.includes(String(meta.difficulty))) errors.push(`difficulty must be one of ${DIFFICULTIES.join(", ")}`);
  if (meta.tags !== undefined && !(Array.isArray(meta.tags) && meta.tags.every((t) => typeof t === "string" && t.trim()))) {
    errors.push("tags must be a list of strings");
  }
  if (meta.timeLimit !== undefined && !(typeof meta.timeLimit === "number" && meta.timeLimit > 0 && meta.timeLimit <= 30)) {
    errors.push("timeLimit must be a number of seconds between 0 and 30");
  }
  if (meta.memoryLimit !== undefined && !(typeof meta.memoryLimit === "number" && meta.memoryLimit > 0)) {
    errors.push("memoryLimit must be a positive number of megabytes");
  }
  if (meta.eps !== undefined && !(typeof meta.eps === "number" && meta.eps > 0)) errors.push("eps must be a positive number");
  for (const k of ["exact", "ignoreCase"] as const) {
    if (meta[k] !== undefined && typeof meta[k] !== "boolean") errors.push(`${k} must be true or false`);
  }
  const tm = meta.timeMultipliers as unknown;
  if (tm !== undefined) {
    if (typeof tm !== "object" || tm === null || Array.isArray(tm)) errors.push('timeMultipliers must be an object like { "java": 2 }');
    else
      for (const [lang, f] of Object.entries(tm)) {
        if (!["cpp", "java", "python"].includes(lang)) errors.push(`timeMultipliers: unknown language "${lang}" (cpp, java or python)`);
        else if (!(typeof f === "number" && f > 0 && f <= 10)) errors.push(`timeMultipliers.${lang} must be a number between 0 and 10`);
      }
  }
  return errors;
}
