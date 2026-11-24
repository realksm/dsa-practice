/**
 * Takes the README screenshots: opens VS Code with the extension on an empty folder, using this
 * repo's problems, and runs scenes.ts in it. Windows only (capture.ps1).
 *
 *   npm run screenshots        -> docs/screenshots/*.png
 *
 * Problems come from the default repo on GitHub, as for a new user (needs the network).
 */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "fs";
import * as os from "os";
import * as path from "path";
import { runTests } from "@vscode/test-electron";

async function main() {
  if (process.platform !== "win32") throw new Error("screenshots are taken on Windows only");
  const root = path.resolve(__dirname, "../../.."); // extension/
  const repo = path.resolve(root, "..");
  // capture.ps1 finds the window by "Extension Development Host" in its title.
  const workspace = path.join(mkdtempSync(path.join(os.tmpdir(), "dsa-drill-shots-")), "my-solutions");
  mkdirSync(workspace);
  const userData = mkdtempSync(path.join(os.tmpdir(), "dsa-drill-shots-ud-"));
  mkdirSync(path.join(userData, "User"), { recursive: true });
  writeFileSync(
    path.join(userData, "User", "settings.json"),
    JSON.stringify(
      {
        "workbench.colorTheme": "Default Dark Modern",
        "workbench.startupEditor": "none",
        "workbench.tips.enabled": false,
        "workbench.secondarySideBar.defaultVisibility": "hidden",
        "chat.disableAIFeatures": true,
        "editor.minimap.enabled": false,
        "editor.fontSize": 14,
        "window.zoomLevel": 0,
        "window.restoreWindows": "none",
        "update.mode": "none",
        "telemetry.telemetryLevel": "off",
        "security.workspace.trust.enabled": false,
        "git.enabled": false,
      },
      null,
      2,
    ),
  );
  const exe = [path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code", "Code.exe"), "C:\\Program Files\\Microsoft VS Code\\Code.exe"].find((p) => existsSync(p));
  await runTests({
    extensionTestsEnv: {
      DSA_DRILL_SHOTS_OUT: path.join(repo, "docs", "screenshots"),
      DSA_DRILL_SHOTS_CAPTURE: path.join(root, "test", "shots", "capture.ps1"),
    },
    vscodeExecutablePath: exe,
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(__dirname, "scenes"),
    launchArgs: [workspace, "--disable-extensions", "--skip-welcome", "--skip-release-notes", "--user-data-dir", userData],
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
