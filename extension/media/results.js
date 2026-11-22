// @ts-check
(function () {
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  /** names of cases whose expanded/collapsed state the user flipped */
  const toggled = new Set(saved.toggled || []);
  let state = null;

  const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const input = /** @type {HTMLTextAreaElement} */ ($("customInput"));
  input.value = saved.customInput || "";

  const save = () => vscode.setState({ toggled: [...toggled], customInput: input.value });
  input.addEventListener("input", save);

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const LABEL = { AC: "PASS", WA: "WA", TLE: "TLE", RE: "RE", OLE: "OLE", NO_EXPECTED: "RAN" };
  const TITLE = {
    AC: "Accepted",
    WA: "Wrong answer",
    TLE: "Time limit exceeded",
    RE: "Runtime error",
    OLE: "Output limit exceeded",
    NO_EXPECTED: "Ran, no expected answer to compare with",
  };

  const ms = (t) => `${Math.round(t)} ms`;

  /** A <pre> with line numbers; `bad` = 1-based line to highlight. */
  function block(label, text, bad, cls = "") {
    const lines = String(text ?? "").replace(/\s+$/, "").split(/\r?\n/);
    const shown = lines.slice(0, 300);
    const body =
      text == null || String(text).trim() === ""
        ? `<span class="muted">&lt;empty&gt;</span>`
        : shown
            .map((l, i) => `<span class="ln${i + 1 === bad ? " bad" : ""}"><i>${i + 1}</i>${esc(l) || " "}</span>`)
            .join("") + (lines.length > shown.length ? `<span class="muted">... ${lines.length - shown.length} more lines</span>` : "");
    return `<div class="block ${cls}"><div class="label">${label}</div><pre>${body}</pre></div>`;
  }

  function details(c) {
    let h = "";
    if (c.message) h += `<p class="msg">${esc(c.message)}</p>`;
    if (c.verdict === "WA" && c.diff) {
      h += `<p class="msg">First difference on line ${c.diff.line}: expected <code>${esc(c.diff.expected)}</code>, got <code>${esc(c.diff.got)}</code></p>`;
    }
    if (c.verdict === "TLE") h += `<p class="msg">Stopped after ${ms(c.timeMs)}. Look for an infinite loop or a slower-than-needed algorithm.</p>`;
    h += block("Input", c.input);
    if (c.verdict !== "NO_EXPECTED" && c.expected != null) {
      h += `<div class="pair">${block("Expected", c.expected, c.diff?.line, "exp")}${block("Your output", c.output, c.diff?.line, "got")}</div>`;
    } else {
      h += block("Your output", c.output);
    }
    if (c.stderr && c.stderr.trim()) h += block(c.verdict === "RE" ? "Error output" : "Debug output (stderr)", c.stderr, undefined, "err");
    return h;
  }

  function header(s) {
    const name = s.fileName ? `<a href="#" id="openFile">${esc(s.fileName)}</a>` : "No solution run yet";
    let summary = "";
    const done = s.cases.length;
    switch (s.phase) {
      case "compiling":
        summary = `<span class="pill run">Compiling…</span>`;
        break;
      case "running":
        summary = `<span class="pill run">Running ${done}/${s.total}</span>`;
        break;
      case "compileError":
        summary = `<span class="pill bad">Compile error</span>`;
        break;
      case "cancelled":
        summary = `<span class="pill muted">Stopped · ${s.passed}/${s.total} passed</span>`;
        break;
      case "error":
        summary = `<span class="pill bad">Error</span>`;
        break;
      case "done": {
        const failed = s.cases.filter((c) => c.verdict !== "AC" && c.verdict !== "NO_EXPECTED").length;
        if (s.total === 0) summary = `<span class="pill muted">No test cases</span>`;
        else if (failed === 0 && s.passed === s.total) summary = `<span class="pill ok">All passed · ${s.passed}/${s.total}</span>`;
        else if (failed === 0) summary = `<span class="pill muted">${s.passed}/${s.total} passed · rest had no answer</span>`;
        else summary = `<span class="pill bad">${s.passed}/${s.total} passed</span>`;
        break;
      }
    }
    const busy = s.phase === "compiling" || s.phase === "running";
    const slowest = s.cases.length ? Math.max(...s.cases.map((c) => c.timeMs)) : 0;
    const meta = s.timeLimitMs ? `<span class="muted">limit ${s.timeLimitMs / 1000}s${slowest ? ` · slowest ${ms(slowest)}` : ""}</span>` : "";
    const btn = s.file
      ? busy
        ? `<button id="stop" class="secondary">Stop</button>`
        : `<button id="rerun">Run tests again</button>`
      : "";
    return `<div class="title">${name}${summary}</div><div class="row">${meta}<span class="grow"></span>${btn}</div>`;
  }

  function cases(s) {
    if (s.phase === "compileError") return `<pre class="compile">${esc(s.compileError)}</pre>`;
    if (s.phase === "error") return `<p class="msg">${esc(s.error)}</p>`;
    if (s.phase === "idle")
      return `<p class="muted">Open a solution file (solution.cpp, Main.java or solution.py next to a .data folder) and click <b>▶ Run Tests</b>.</p>`;
    let h = "";
    for (const c of s.cases) {
      // everything except passes opens by default (failures, and RAN so you can see the output)
      const open = (c.verdict !== "AC") !== toggled.has(c.name);
      h += `<div class="case ${c.verdict}${open ? " open" : ""}" data-name="${esc(c.name)}">
        <div class="case-head" title="${TITLE[c.verdict]}">
          <span class="chev">${open ? "▾" : "▸"}</span>
          <span class="verdict">${LABEL[c.verdict]}</span>
          <span class="name">Case ${esc(c.name)}</span>
          <span class="grow"></span>
          <span class="muted">${c.verdict === "TLE" ? "&gt; " : ""}${ms(c.timeMs)}</span>
        </div>
        ${open ? `<div class="case-body">${details(c)}</div>` : ""}
      </div>`;
    }
    for (let i = s.cases.length; i < s.total && (s.phase === "running" || s.phase === "compiling"); i++) {
      h += `<div class="case pending"><div class="case-head"><span class="chev"> </span><span class="verdict">…</span><span class="name muted">waiting</span></div></div>`;
    }
    return h;
  }

  function customResult(s) {
    const c = s.custom;
    $("customStatus").textContent = c.running ? "Running…" : "";
    /** @type {HTMLButtonElement} */ ($("customRun")).disabled = !s.file || c.running;
    if (c.compileError) return `<pre class="compile">${esc(c.compileError)}</pre>`;
    const r = c.result;
    if (!r) return "";
    let h = `<div class="row"><span class="verdict-inline ${r.verdict}">${r.verdict === "NO_EXPECTED" ? "OK" : LABEL[r.verdict]}</span><span class="muted">${ms(r.timeMs)}</span></div>`;
    if (r.message) h += `<p class="msg">${esc(r.message)}</p>`;
    h += block("Output", r.output);
    if (r.stderr && r.stderr.trim()) h += block(r.verdict === "RE" ? "Error output" : "Debug output (stderr)", r.stderr, undefined, "err");
    return h;
  }

  function render() {
    if (!state) return;
    $("header").innerHTML = header(state);
    $("cases").innerHTML = cases(state);
    $("customResult").innerHTML = customResult(state);
    // lets the extension (and its tests) know what was actually drawn
    vscode.postMessage({ type: "rendered", header: $("header").innerText, cases: $("cases").innerText });
  }

  document.addEventListener("click", (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (t.closest("#rerun")) return vscode.postMessage({ type: "rerun" });
    if (t.closest("#stop")) return vscode.postMessage({ type: "stop" });
    if (t.closest("#openFile")) {
      e.preventDefault();
      return vscode.postMessage({ type: "openFile" });
    }
    const head = t.closest(".case-head");
    const box = head && /** @type {HTMLElement} */ (head.parentElement);
    if (box && box.dataset.name !== undefined) {
      const n = box.dataset.name;
      toggled.has(n) ? toggled.delete(n) : toggled.add(n);
      save();
      render();
    }
  });

  const runCustom = () => vscode.postMessage({ type: "custom", input: input.value });
  $("customRun").addEventListener("click", runCustom);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      runCustom();
    }
  });

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m.type === "state") {
      // a new run starts with fresh expand/collapse choices
      if (state && m.state.phase === "compiling" && state.phase !== "compiling") {
        toggled.clear();
        save();
      }
      state = m.state;
      render();
    } else if (m.type === "focusCustom") {
      $("custom").scrollIntoView();
      input.focus();
    }
  });

  vscode.postMessage({ type: "ready" });
})();
