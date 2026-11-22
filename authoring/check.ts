/**
 * Check that every problem is publishable and index.json is current. Runs in CI.
 *
 *   npm run check
 *
 * Needs no compilers and no references/: it only looks at problems/ and index.json.
 */
import { promises as fs } from "fs";
import * as path from "path";
import { buildIndex, INDEX_FILE, indexText } from "../extension/src/problems/indexFile";
import { problemSlugs, ROOT, validateProblem } from "./common";

async function main() {
  const errors: string[] = [];
  for (const slug of await problemSlugs()) {
    const problems = await validateProblem(slug);
    errors.push(...problems.map((m) => `${slug}: ${m}`));
    if (!problems.length) console.log(`  ok  ${slug}`);
  }

  const { index, skipped, warnings } = await buildIndex(ROOT);
  // Every folder under problems/ is meant to be published; a skipped one is a mistake.
  errors.push(...skipped.map((s) => `${s.slug}: left out of ${INDEX_FILE} (${s.reason})`));
  errors.push(...warnings.map((w) => `${w.slug}: ${w.message}`));

  const current = await fs.readFile(path.join(ROOT, INDEX_FILE), "utf8").catch(() => "");
  if (current.replace(/\r\n/g, "\n") !== indexText(index)) errors.push(`${INDEX_FILE} is out of date: run npm run build and commit it`);

  if (errors.length) {
    console.error(`\n${[...new Set(errors)].map((e) => `  ERROR  ${e}`).join("\n")}\n\n${new Set(errors).size} problem(s) found.`);
    process.exit(1);
  }
  console.log(`\nAll ${index.problems.length} problems are valid and ${INDEX_FILE} is up to date.`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
