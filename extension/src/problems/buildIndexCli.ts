/**
 * Rebuild index.json from problems/.
 *
 *   npm run index                 the repo this extension lives in (..)
 *   npm run index -- <repoRoot>   another checkout
 *   npm run index -- --check      fail if index.json is out of date (for CI)
 */
import { promises as fs } from "fs";
import * as path from "path";
import { buildIndex, INDEX_FILE, indexText } from "./indexFile";

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const root = path.resolve(args.find((a) => !a.startsWith("--")) ?? path.join(__dirname, "../../../.."));
  const { index, skipped, warnings } = await buildIndex(root);
  const text = indexText(index);
  const file = path.join(root, INDEX_FILE);

  for (const s of skipped) console.log(`  skipped  ${s.slug}: ${s.reason}`);
  for (const w of warnings) console.log(`  warning  ${w.slug}: ${w.message}`);
  for (const p of index.problems) console.log(`  ok       ${p.slug}  (${p.files.filter((f) => f.endsWith(".in")).length} tests, ${p.hash})`);

  if (check) {
    const current = await fs.readFile(file, "utf8").catch(() => "");
    if (current.replace(/\r\n/g, "\n") !== text) {
      console.error(`\n${INDEX_FILE} is out of date. Run: npm run index`);
      process.exit(1);
    }
    console.log(`\n${INDEX_FILE} is up to date (${index.problems.length} problems).`);
    return;
  }
  await fs.writeFile(file, text);
  console.log(`\nWrote ${file} (${index.problems.length} problems).`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
