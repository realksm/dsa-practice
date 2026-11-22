/**
 * Start a new problem.
 *
 *   npm run new <slug>
 *
 * Creates problems/<slug>/ (problem.md, meta.json, .data/) and references/<slug>/ref.cpp.
 * references/ is gitignored: reference solutions are never committed.
 */
import { promises as fs } from "fs";
import * as path from "path";
import { DATA_DIR } from "../extension/src/judge/tests";
import { isValidSlug } from "../extension/src/problems/indexFile";
import { exists, PROBLEMS, REFERENCES, ROOT, titleFromSlug } from "./common";

const problemMd = (title: string) => `# ${title}

TODO: the statement.

## Input

TODO: the exact input format.

## Output

TODO: the exact output format.

## Constraints

- TODO

## Example

Input:

\`\`\`
TODO
\`\`\`

Output:

\`\`\`
TODO
\`\`\`
`;

const REF_CPP = `// Reference solution: its output on every .data/*.in becomes the expected .out.
// Private: references/ is gitignored. Optional helpers next to it, for npm run build -- --stress:
//   gen.py     prints one random small input; the seed is sys.argv[1]
//   naive.cpp  slow but obviously correct (naive.py / Naive.java also work)
#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    return 0;
}
`;

async function main() {
  const slug = process.argv[2];
  if (!slug || process.argv.length > 3) throw new Error("Usage: npm run new <slug>   (e.g. npm run new two-sum)");
  if (!isValidSlug(slug)) throw new Error(`'${slug}' is not a valid slug: use lowercase letters, digits and dashes.`);

  const dir = path.join(PROBLEMS, slug);
  const refDir = path.join(REFERENCES, slug);
  if (await exists(dir)) throw new Error(`problems/${slug} already exists.`);

  const title = titleFromSlug(slug);
  const meta = { title, difficulty: "easy", tags: [] as string[], timeLimit: 1, memoryLimit: 256 };
  await fs.mkdir(path.join(dir, DATA_DIR), { recursive: true });
  await fs.writeFile(path.join(dir, "problem.md"), problemMd(title));
  await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");

  await fs.mkdir(refDir, { recursive: true });
  const ref = path.join(refDir, "ref.cpp");
  if (!(await exists(ref))) await fs.writeFile(ref, REF_CPP);

  const rel = (p: string) => path.relative(ROOT, p).replace(/\\/g, "/");
  console.log(`Created ${rel(dir)}/ and ${rel(refDir)}/

Next:
  1. ${rel(dir)}/problem.md       write the statement
  2. ${rel(dir)}/meta.json        difficulty (easy/medium/hard), tags, timeLimit (seconds)
  3. ${rel(dir)}/${DATA_DIR}/01.in, 02.in ...   test inputs (no outputs)
  4. ${rel(ref)}     the reference solution (or ref.py / Ref.java)
  5. npm run build -- ${slug}   writes the .out files and rebuilds index.json`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
