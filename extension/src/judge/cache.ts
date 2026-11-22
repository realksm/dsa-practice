/**
 * Keeps compiled programs between runs, so Run Tests, Run Custom Input and the stress test
 * compile a file once until it changes. Keyed by the source text, the compiler settings and the
 * file's path (Java needs the class name, and errors name the path). Failed compiles are not kept:
 * the fix may be installing a compiler, which doesn't change the key.
 */
import { createHash } from "crypto";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { PrepareResult, prepare, stripEmpty, ToolPaths } from "./languages";

type Ok = Extract<PrepareResult, { ok: true }>;

export class ProgramCache {
  /** Most recently used last. */
  private entries = new Map<string, { dir: string; result: Promise<PrepareResult> }>();

  constructor(private readonly maxEntries = 8) {}

  /** The compiled program for `src`, compiling it if this exact text wasn't compiled before. */
  async get(src: string, tools: ToolPaths = {}): Promise<PrepareResult & { cached?: boolean }> {
    const file = path.resolve(src);
    const text = await fs.readFile(file);
    const key = createHash("sha256")
      .update(file.toLowerCase())
      .update("\0")
      .update(JSON.stringify(stripEmpty(tools)))
      .update("\0")
      .update(text)
      .digest("hex");

    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      const r = await hit.result;
      return r.ok ? { ...r, cached: true } : r;
    }

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsa-drill-"));
    const result = prepare(file, dir, tools);
    const entry = { dir, result };
    this.entries.set(key, entry);
    const r = await result.catch((e): PrepareResult => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    if (!r.ok) {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      await removeDir(dir);
      return r;
    }
    await this.evict();
    return r as Ok;
  }

  private async evict() {
    while (this.entries.size > this.maxEntries) {
      const [key, old] = this.entries.entries().next().value!;
      this.entries.delete(key);
      await removeDir(old.dir);
    }
  }

  /** Delete every kept program (on deactivate). */
  async clear() {
    const dirs = [...this.entries.values()].map((e) => e.dir);
    this.entries.clear();
    await Promise.all(dirs.map(removeDir));
  }
}

// On Windows the .exe can stay locked for a moment after it exits (or while it still runs).
const removeDir = (dir: string) => fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
