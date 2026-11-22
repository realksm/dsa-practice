/** The Stats view: solved counts, streak and a year of activity, as one webview page. */
import * as vscode from "vscode";
import type { Stats } from "../problems/stats";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Runs on a day -> heat level 0..4. Fixed steps, so a busy day reads the same across months. */
export function heatLevel(runs: number): number {
  return runs <= 0 ? 0 : runs <= 2 ? 1 : runs <= 5 ? 2 : runs <= 9 ? 3 : 4;
}

function parseDay(k: string): Date {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dayLabel(k: string): string {
  const d = parseDay(k);
  return `${WEEKDAYS[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function describeDay(day: Stats["days"][number]): string {
  if (!day.runs && !day.solved) return `${dayLabel(day.date)}: no runs`;
  const parts = [plural(day.runs, "run")];
  if (day.runs) parts.push(`${day.accepted} passed`);
  if (day.solved) parts.push(`${day.solved} newly solved`);
  return `${dayLabel(day.date)}: ${parts.join(", ")}`;
}

function meters(rows: { name: string; solved: number; total: number }[]): string {
  if (!rows.length) return `<p class="muted">None yet.</p>`;
  return `<div class="meters">${rows
    .map((r) => {
      const pct = r.total ? Math.round((r.solved / r.total) * 100) : 0;
      return `<span class="name" title="${esc(r.name)}">${esc(r.name)}</span>
        <div class="bar" role="img" aria-label="${esc(r.name)}: ${r.solved} of ${r.total} solved"><span style="width:${pct}%"></span></div>
        <span class="fig">${r.solved} / ${r.total}</span>`;
    })
    .join("")}</div>`;
}

function heatmap(s: Stats, todayKey: string): string {
  const weeks = Math.ceil(s.days.length / 7);
  // a month's name over the first week that starts in it; a label with less than 3 weeks of room
  // before the next one (the partial month at the left edge) is left out so names don't collide
  const starts: { week: number; month: number }[] = [];
  for (let w = 0; w < weeks; w++) {
    const m = parseDay(s.days[w * 7].date).getMonth();
    if (!starts.length || starts[starts.length - 1].month !== m) starts.push({ week: w, month: m });
  }
  const labels = new Map(starts.filter((st, i) => (starts[i + 1]?.week ?? weeks) - st.week >= 3).map((st) => [st.week, MONTHS[st.month]]));
  let months = "";
  for (let w = 0; w < weeks; w++) months += `<span>${labels.get(w) ?? ""}</span>`;
  const cells = s.days
    .map((d) => {
      const lvl = heatLevel(d.runs);
      const label = describeDay(d);
      return `<div class="cell${lvl ? " l" + lvl : ""}${d.date === todayKey ? " today" : ""}" tabindex="-1" data-tip="${esc(label)}" aria-label="${esc(label)}"></div>`;
    })
    .join("");
  const wdays = WEEKDAYS.map((w, i) => `<span>${i % 2 === 0 ? w : ""}</span>`).join("");
  const legendCells = [0, 1, 2, 3, 4].map((l) => `<span class="cell${l ? " l" + l : ""}"></span>`).join("");
  return `<div class="heat-wrap"><div class="heat" role="group" aria-label="Runs per day over the last ${weeks} weeks">
      <div class="months" aria-hidden="true">${months}</div>
      <div class="wdays" aria-hidden="true">${wdays}</div>
      <div class="cells">${cells}</div>
    </div></div>
    <div class="legend"><button class="link" id="toggleTable">Show as table</button><span class="grow"></span>Less ${legendCells} More
      <span class="muted">&nbsp;(1–2, 3–5, 6–9, 10+ runs)</span></div>
    <div id="table" hidden>${dayTable(s)}</div>`;
}

function dayTable(s: Stats): string {
  const active = s.days.filter((d) => d.runs || d.solved).reverse();
  if (!active.length) return `<p class="muted">No runs in this period.</p>`;
  return `<table><thead><tr><th>Day</th><th class="n">Runs</th><th class="n">Passed</th><th class="n">Newly solved</th></tr></thead><tbody>${active
    .map((d) => `<tr><td>${esc(dayLabel(d.date))}</td><td class="n">${d.runs}</td><td class="n">${d.accepted}</td><td class="n">${d.solved}</td></tr>`)
    .join("")}</tbody></table>`;
}

export function renderStats(s: Stats, repo: string, todayKey: string): string {
  const pct = s.total ? Math.round((s.solved / s.total) * 100) : 0;
  const streakNote = s.streak.current
    ? s.streak.activeToday
      ? "including today"
      : "run tests today to keep it"
    : "run tests today to start one";
  const tiles = `<div class="tiles">
    <div class="tile"><div class="label">Solved</div><div class="value">${s.solved}<small> / ${s.total}</small></div><div class="note">${pct}% of ${esc(repo)}</div></div>
    <div class="tile"><div class="label">Current streak</div><div class="value">${s.streak.current}<small> ${s.streak.current === 1 ? "day" : "days"}</small></div><div class="note">${streakNote}</div></div>
    <div class="tile"><div class="label">Longest streak</div><div class="value">${s.streak.longest}<small> ${s.streak.longest === 1 ? "day" : "days"}</small></div><div class="note">days in a row with a run</div></div>
    <div class="tile"><div class="label">Active days</div><div class="value">${s.activeDays}</div><div class="note">${plural(s.runs, "run")} in the last year</div></div>
  </div>`;
  const langs = s.byLanguage.length ? s.byLanguage.map((l) => `${esc(l.name)} ${l.solved}`).join(" · ") : "nothing solved yet";
  return `${tiles}
    <h2>Activity</h2>
    ${heatmap(s, todayKey)}
    <div class="cols">
      <section><h2>By difficulty</h2>${meters(s.byDifficulty)}</section>
      <section><h2>By tag</h2>${meters(s.byTag)}</section>
    </div>
    <h2>Languages</h2><p>Solved in ${langs}.</p>`;
}

export class StatsPanel {
  private panel?: vscode.WebviewPanel;
  /** What was drawn last, for the VS Code tests. */
  lastHtml?: string;

  constructor(private readonly extensionUri: vscode.Uri) {}

  get visible(): boolean {
    return !!this.panel;
  }

  show(stats: Stats, repo: string, todayKey: string) {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel("dsaDrill.stats", "DSA Drill Stats", vscode.ViewColumn.Active, {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
      });
      this.panel.onDidDispose(() => (this.panel = undefined));
    } else this.panel.reveal();
    this.update(stats, repo, todayKey);
  }

  update(stats: Stats, repo: string, todayKey: string) {
    if (!this.panel) return;
    const webview = this.panel.webview;
    const nonce = [...Array(32)].map(() => Math.floor(Math.random() * 36).toString(36)).join("");
    const css = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "stats.css"));
    const body = renderStats(stats, repo, todayKey);
    this.lastHtml = body;
    webview.html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}"><title>DSA Drill Stats</title></head>
<body><h1>Your practice</h1><p class="muted sub">${esc(repo)} · counts every Run Tests of a downloaded problem</p>
${body}<div id="tip" role="tooltip"></div>
<script nonce="${nonce}">
(() => {
  const tip = document.getElementById("tip");
  const show = (el) => {
    tip.textContent = el.dataset.tip;
    tip.style.display = "block";
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    tip.style.left = Math.max(4, Math.min(window.innerWidth - w - 4, r.left + r.width / 2 - w / 2)) + "px";
    tip.style.top = (r.top - tip.offsetHeight - 6 < 0 ? r.bottom + 6 : r.top - tip.offsetHeight - 6) + "px";
  };
  document.addEventListener("mouseover", (e) => { const c = e.target.closest && e.target.closest("[data-tip]"); if (c) show(c); else tip.style.display = "none"; });
  document.addEventListener("mouseleave", () => (tip.style.display = "none"));
  const t = document.getElementById("toggleTable");
  if (t) t.addEventListener("click", () => {
    const tbl = document.getElementById("table");
    tbl.hidden = !tbl.hidden;
    t.textContent = tbl.hidden ? "Show as table" : "Hide table";
  });
})();
</script></body></html>`;
  }

  dispose() {
    this.panel?.dispose();
  }
}
