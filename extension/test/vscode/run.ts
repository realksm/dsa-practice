/**
 * Launches VS Code with the extension loaded and runs suite.ts inside it.
 * Uses the VS Code installed on this machine if it can find it (no download),
 * otherwise @vscode/test-electron downloads one.
 *
 *   npm run test:vscode
 */
import { existsSync, mkdtempSync } from "fs";
import * as os from "os";
import * as path from "path";
import { runTests } from "@vscode/test-electron";

function installedVSCode(): string | undefined {
  // VSCODE_EXECUTABLE=download forces a fresh download (e.g. while the installed one is updating)
  if (process.env.VSCODE_EXECUTABLE === "download") return undefined;
  if (process.env.VSCODE_EXECUTABLE) return process.env.VSCODE_EXECUTABLE;
  const candidates =
    process.platform === "win32"
      ? [path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code", "Code.exe"), "C:\\Program Files\\Microsoft VS Code\\Code.exe"]
      : process.platform === "darwin"
        ? ["/Applications/Visual Studio Code.app/Contents/MacOS/Electron"]
        : ["/usr/share/code/code"];
  return candidates.find((p) => existsSync(p));
}

async function main() {
  const root = path.resolve(__dirname, "../../..");
  const workspace = mkdtempSync(path.join(os.tmpdir(), "dsa-drill-ws-"));
  // copy the fixture workspace so tests can write files into it
  const fs = await import("fs/promises");
  await fs.cp(path.join(root, "test", "fixtures", "workspace"), workspace, { recursive: true });
  // a local "problems repo" (dsaDrill.repo accepts a folder); copied so tests can change its tests
  const repo = mkdtempSync(path.join(os.tmpdir(), "dsa-drill-repo-"));
  await fs.cp(path.join(root, "test", "fixtures", "repo"), repo, { recursive: true });
  await runTests({
    extensionTestsEnv: { DSA_DRILL_TEST_REPO: repo },
    vscodeExecutablePath: installedVSCode(),
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(__dirname, "suite"),
    launchArgs: [workspace, "--disable-extensions", "--skip-welcome", "--skip-release-notes", "--user-data-dir", mkdtempSync(path.join(os.tmpdir(), "dsa-drill-ud-"))],
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
