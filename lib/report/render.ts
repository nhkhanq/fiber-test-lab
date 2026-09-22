import { formatAmount, type ReportEdge, type ReportModel, type ReportNode } from "./model";

/** ReportModel -> ONE self-contained HTML document. No sibling asset files and no network access,
 *  so the report opens over file:// and survives being archived as a CI artifact
 *  (decisions-log 2026-09-22 — Playwright's folder report needs a server, which defeats that). */

export const escapeHtml = (value: unknown): string =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** `</script` would close the host <script> tag early, and U+2028/U+2029 are literal line breaks
 *  to a JS parser even inside a string — both break an inline <script> that embeds JSON. */
const embedJson = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/[\u2028]/g, "\\u2028")
    .replace(/[\u2029]/g, "\\u2029");

export function formatDuration(msValue: number | null): string {
  if (msValue === null) return "—";
  if (msValue < 1000) return `${msValue}ms`;
  if (msValue < 60_000) return `${(msValue / 1000).toFixed(1)}s`;
  const minutes = Math.floor(msValue / 60_000);
  return `${minutes}m ${Math.round((msValue % 60_000) / 1000)}s`;
}

const NODE_RADIUS = 30;
const GRAPH_HEIGHT = 220;
const GRAPH_PADDING = 90;

function nodePositions(nodes: ReportNode[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const spacing = 220;
  nodes.forEach((node, index) => {
    positions.set(node.name, {
      x: GRAPH_PADDING + spacing * index,
      // Alternate the vertical offset so a 3-node route reads as a route, not a straight line.
      y: GRAPH_HEIGHT / 2 + (nodes.length > 2 && index % 2 === 1 ? -40 : 0),
    });
  });
  return positions;
}

function renderEdge(edge: ReportEdge, positions: Map<string, { x: number; y: number }>): string {
  const a = positions.get(edge.a);
  const b = positions.get(edge.b);
  if (!a || !b) return "";

  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const total = (() => {
    try {
      return BigInt(edge.aBalance ?? "0") + BigInt(edge.bBalance ?? "0");
    } catch {
      return 0n;
    }
  })();
  // How far along the channel the liquidity sits — the whole point of the picture.
  const ratio = total === 0n ? 0.5 : Number((BigInt(edge.aBalance ?? "0") * 1000n) / total) / 1000;
  const splitX = a.x + (b.x - a.x) * ratio;
  const splitY = a.y + (b.y - a.y) * ratio;
  const klass = edge.onPaymentPath ? "edge on-path" : "edge";

  return `
      <g class="${klass}">
        <line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="edge-line" />
        <line x1="${a.x}" y1="${a.y}" x2="${splitX}" y2="${splitY}" class="edge-local" />
        <circle cx="${splitX}" cy="${splitY}" r="4" class="edge-split" />
        <text x="${midX}" y="${midY - 16}" class="edge-label">${escapeHtml(edge.state)}</text>
        <text x="${midX}" y="${midY + 24}" class="edge-balance">${escapeHtml(
          formatAmount(edge.aBalance, edge.asset),
        )} · ${escapeHtml(formatAmount(edge.bBalance, edge.asset))}</text>
      </g>`;
}

function renderGraph(model: ReportModel): string {
  const nodes = model.nodes.filter((n) => !n.isChain);
  if (nodes.length === 0) return `<p class="empty">This run recorded no nodes.</p>`;

  const positions = nodePositions(nodes);
  const width = GRAPH_PADDING * 2 + 220 * Math.max(nodes.length - 1, 0);

  const nodeMarkup = nodes
    .map((node) => {
      const p = positions.get(node.name)!;
      return `
      <g class="node">
        <circle cx="${p.x}" cy="${p.y}" r="${NODE_RADIUS}" />
        <text x="${p.x}" y="${p.y + 5}" class="node-label">${escapeHtml(node.name)}</text>
      </g>`;
    })
    .join("");

  const edgeMarkup = model.edges.map((edge) => renderEdge(edge, positions)).join("");
  const note =
    model.edges.length === 0
      ? `<p class="empty">No channel snapshot was recorded for this run — it predates the <code>channels</code> field, or no channel was opened.</p>`
      : "";

  return `${note}
    <svg viewBox="0 0 ${width} ${GRAPH_HEIGHT}" class="graph" role="img"
         aria-label="Channel topology">${edgeMarkup}${nodeMarkup}
    </svg>
    <p class="legend">
      The thick segment is the <strong>left node's local balance</strong>; the dot marks the split.
      A highlighted edge is the reconstructed payment path (FNN does not report the route it chose).
    </p>`;
}

function renderTimeline(model: ReportModel): string {
  if (model.steps.length === 0) return `<p class="empty">This run recorded no steps.</p>`;
  const span = Math.max(
    ...model.steps.map((s) => s.offsetMs + (s.durationMs ?? 0)),
    1,
  );

  const rows = model.steps
    .map((step) => {
      const left = (step.offsetMs / span) * 100;
      const width = Math.max(((step.durationMs ?? 0) / span) * 100, 0.6);
      const klass = step.running ? "step running" : step.ok ? "step" : "step failed";
      return `
      <li class="${klass}">
        <div class="step-head">
          <span class="step-action">${escapeHtml(step.action)}</span>
          <span class="step-summary">${escapeHtml(step.summary)}</span>
          <span class="step-time">+${formatDuration(step.offsetMs)} ·
            <span class="step-elapsed" data-started="${escapeHtml(step.at)}">${formatDuration(
              step.durationMs,
            )}</span>${step.running ? " so far" : ""}</span>
        </div>
        <div class="track"><div class="bar" style="left:${left.toFixed(2)}%;width:${width.toFixed(
          2,
        )}%"></div></div>
        ${
          step.progress === null
            ? ""
            : `<p class="step-progress">${escapeHtml(step.progress)}</p>`
        }
      </li>`;
    })
    .join("");

  return `<ol class="timeline">${rows}</ol>`;
}

function renderRpcTable(model: ReportModel): string {
  if (model.rpcCalls.length === 0) return `<p class="empty">This run recorded no RPC calls.</p>`;

  const nodeOptions = [...new Set(model.rpcCalls.map((c) => c.node))]
    .sort()
    .map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`)
    .join("");
  const methodOptions = model.methods
    .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
    .join("");

  const rows = model.rpcCalls
    .map(
      (call) => `
      <tr class="rpc-row${call.ok ? "" : " failed"}" data-node="${escapeHtml(
        call.node,
      )}" data-method="${escapeHtml(call.method)}" data-ok="${call.ok}" data-index="${call.index}">
        <td class="num">+${formatDuration(call.offsetMs)}</td>
        <td>${escapeHtml(call.node)}</td>
        <td class="method">${escapeHtml(call.method)}</td>
        <td class="num">${formatDuration(call.durationMs)}</td>
        <td>${call.ok ? "ok" : escapeHtml(call.errorMessage ?? "error")}</td>
      </tr>
      <tr class="detail" data-detail="${call.index}" hidden>
        <td colspan="5"><pre></pre></td>
      </tr>`,
    )
    .join("");

  return `
    <div class="filters">
      <input type="search" id="rpc-search" placeholder="Filter by method, node or error…" />
      <select id="rpc-node"><option value="">every node</option>${nodeOptions}</select>
      <select id="rpc-method"><option value="">every method</option>${methodOptions}</select>
      <label><input type="checkbox" id="rpc-errors" /> errors only</label>
      <span id="rpc-count" class="count"></span>
    </div>
    <table class="rpc">
      <thead>
        <tr><th>at</th><th>node</th><th>method</th><th>took</th><th>result</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="legend">Click a row for the raw params and response.</p>`;
}

const STYLES = `
  :root {
    color-scheme: light dark;
    --bg: #ffffff; --panel: #f6f7f9; --border: #d8dce3; --text: #14171c; --muted: #646b78;
    --accent: #2f6df6; --ok: #1f8a4c; --fail: #cf2f3f; --bar: #8fa6d8;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #12151a; --panel: #1a1f27; --border: #2c333e; --text: #e6e9ef; --muted: #95a0b0;
      --accent: #6c9bff; --ok: #4cc97f; --fail: #ff6b78; --bar: #3f5a9c;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 16px 64px; background: var(--bg); color: var(--text);
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .wrap { max-width: 1040px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 32px 0 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
  code, pre, .method, .num { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .sub { color: var(--muted); margin: 0 0 16px; }
  .pills { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
  .pill { border: 1px solid var(--border); border-radius: 999px; padding: 2px 10px; font-size: 12px; background: var(--panel); }
  .pill.ok { border-color: var(--ok); color: var(--ok); }
  .pill.fail { border-color: var(--fail); color: var(--fail); }
  .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
  .error-box { border-left: 3px solid var(--fail); padding: 8px 12px; margin: 12px 0; background: var(--panel); white-space: pre-wrap; }
  .empty, .legend { color: var(--muted); font-size: 13px; }
  .graph { width: 100%; height: auto; }
  .node circle { fill: var(--panel); stroke: var(--accent); stroke-width: 2; }
  .node-label { text-anchor: middle; font-size: 13px; fill: var(--text); font-weight: 600; }
  .edge-line { stroke: var(--border); stroke-width: 10; stroke-linecap: round; }
  .edge-local { stroke: var(--bar); stroke-width: 10; stroke-linecap: round; }
  .edge-split { fill: var(--text); }
  .on-path .edge-local { stroke: var(--accent); }
  .edge-label, .edge-balance { text-anchor: middle; font-size: 11px; fill: var(--muted); }
  .timeline { list-style: none; margin: 0; padding: 0; }
  .step { border-bottom: 1px solid var(--border); padding: 10px 0; }
  .step-head { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  .step-action { font-weight: 600; font-family: ui-monospace, monospace; }
  .step-summary { color: var(--muted); flex: 1; min-width: 160px; }
  .step-time { color: var(--muted); font-size: 12px; }
  .step.failed .step-action { color: var(--fail); }
  .track { position: relative; height: 6px; background: var(--panel); border-radius: 3px; margin-top: 6px; }
  .bar { position: absolute; top: 0; height: 6px; border-radius: 3px; background: var(--bar); min-width: 2px; }
  .step.failed .bar { background: var(--fail); }
  .step.running .step-action::after {
    content: ""; display: inline-block; width: 6px; height: 6px; margin-left: 6px;
    border-radius: 50%; background: var(--accent); animation: pulse 1s ease-in-out infinite;
  }
  .step.running .bar { background: var(--accent); animation: pulse 1.4s ease-in-out infinite; }
  .step-progress { margin: 6px 0 0; font-size: 12px; color: var(--muted); font-family: ui-monospace, monospace; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
  @media (prefers-reduced-motion: reduce) { .step.running .step-action::after, .step.running .bar { animation: none; } }
  .filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 10px; }
  .filters input[type=search], .filters select {
    background: var(--bg); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 5px 8px; font: inherit;
  }
  .filters input[type=search] { flex: 1; min-width: 200px; }
  .count { color: var(--muted); font-size: 12px; }
  table.rpc { width: 100%; border-collapse: collapse; }
  table.rpc th { text-align: left; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--border); padding: 6px 8px; }
  .rpc-row td { padding: 5px 8px; border-bottom: 1px solid var(--border); cursor: pointer; }
  .rpc-row:hover td { background: var(--panel); }
  .rpc-row.failed td { color: var(--fail); }
  .num { text-align: right; white-space: nowrap; }
  .detail pre { margin: 0; padding: 10px; background: var(--panel); border-radius: 6px; overflow-x: auto; font-size: 12px; }
  a { color: var(--accent); }
  footer { margin-top: 40px; color: var(--muted); font-size: 12px; }
  @media (max-width: 600px) { body { padding: 16px; } .step-time { width: 100%; } }
`;

const SCRIPT = `
  const model = JSON.parse(document.getElementById("run-data").textContent);
  const rpcByIndex = new Map(model.rpcCalls.map((c) => [c.index, c]));

  const search = document.getElementById("rpc-search");
  const nodeSelect = document.getElementById("rpc-node");
  const methodSelect = document.getElementById("rpc-method");
  const errorsOnly = document.getElementById("rpc-errors");
  const count = document.getElementById("rpc-count");
  const rows = Array.from(document.querySelectorAll(".rpc-row"));

  function apply() {
    if (!count) return;
    const text = (search.value || "").toLowerCase();
    let shown = 0;
    for (const row of rows) {
      const call = rpcByIndex.get(Number(row.dataset.index));
      const haystack = (call.node + " " + call.method + " " + (call.errorMessage || "")).toLowerCase();
      const visible =
        (!text || haystack.includes(text)) &&
        (!nodeSelect.value || row.dataset.node === nodeSelect.value) &&
        (!methodSelect.value || row.dataset.method === methodSelect.value) &&
        (!errorsOnly.checked || row.dataset.ok === "false");
      row.hidden = !visible;
      if (!visible) {
        const detail = document.querySelector('[data-detail="' + row.dataset.index + '"]');
        if (detail) detail.hidden = true;
      }
      if (visible) shown++;
    }
    count.textContent = shown + " of " + rows.length + " calls";
  }

  for (const control of [search, nodeSelect, methodSelect, errorsOnly]) {
    if (control) control.addEventListener("input", apply);
  }

  for (const row of rows) {
    row.addEventListener("click", () => {
      const detail = document.querySelector('[data-detail="' + row.dataset.index + '"]');
      if (!detail) return;
      if (detail.hidden) {
        const call = rpcByIndex.get(Number(row.dataset.index));
        detail.querySelector("pre").textContent =
          "params:\\n" + JSON.stringify(call.params, null, 2) +
          "\\n\\n" + (call.ok ? "response:\\n" + JSON.stringify(call.response, null, 2)
                             : "error:\\n" + JSON.stringify(call.error, null, 2));
      }
      detail.hidden = !detail.hidden;
    });
  }

  apply();

  // The elapsed time of a running step would otherwise sit frozen between reloads.
  const elapsedCell = document.querySelector(".step.running .step-elapsed");
  if (elapsedCell) {
    const startedAt = Date.parse(elapsedCell.dataset.started);
    setInterval(() => {
      const elapsed = Date.now() - startedAt;
      elapsedCell.textContent =
        elapsed < 60000
          ? (elapsed / 1000).toFixed(1) + "s"
          : Math.floor(elapsed / 60000) + "m " + Math.round((elapsed % 60000) / 1000) + "s";
    }, 500);
  }
`;

export interface RenderOptions {
  /** Served by `fiber-lab ui`: poll for run-log changes so a run still being built fills in. */
  live?: boolean;
  /** Served by `fiber-lab ui`: a link back to the run list. */
  backHref?: string;
}

/** Polls the run's own JSON and reloads when the run-log grew. Cheap, and it means the live page
 *  and the exported file render through exactly the same code path. */
const LIVE_SCRIPT = `
  (function () {
    let current = JSON.parse(document.getElementById("run-data").textContent).fingerprint;
    const tick = async () => {
      try {
        const res = await fetch(location.pathname + ".json", { cache: "no-store" });
        if (res.ok && (await res.json()).fingerprint !== current) location.reload();
      } catch (e) {
        /* the server went away — keep showing the last render */
      }
    };
    setInterval(tick, 1000);
  })();
`;

export function renderRunList(
  runs: { runId: string; scenario: string; status: string; startedAt: string; steps: number }[],
): string {
  const rows =
    runs.length === 0
      ? `<p class="empty">No runs in <code>.fiber-lab/runs/</code> yet — build one with <code>fiber-lab up &lt;scenario&gt;</code>.</p>`
      : `<table class="rpc"><thead><tr><th>run</th><th>scenario</th><th>status</th><th>started</th><th>steps</th></tr></thead><tbody>${runs
          .map(
            (run) => `<tr class="rpc-row${run.status === "failed" ? " failed" : ""}">
            <td class="method"><a href="/run/${escapeHtml(run.runId)}">${escapeHtml(
              run.runId,
            )}</a></td>
            <td>${escapeHtml(run.scenario)}</td>
            <td>${escapeHtml(run.status)}</td>
            <td>${escapeHtml(run.startedAt)}</td>
            <td class="num">${run.steps}</td>
          </tr>`,
          )
          .join("")}</tbody></table>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="refresh" content="3" />
<title>fiber-lab runs</title>
<style>${STYLES}
  a { color: var(--accent); }
</style>
</head>
<body>
<div class="wrap">
  <h1>fiber-lab runs</h1>
  <p class="sub">Read from <code>.fiber-lab/runs/</code>. This page never contacts a node.</p>
  ${rows}
</div>
</body>
</html>
`;
}

export function renderReport(model: ReportModel, options: RenderOptions = {}): string {
  const s = model.summary;
  const verdictPill =
    s.verdict === "unknown"
      ? ""
      : `<span class="pill ${s.verdict === "match" ? "ok" : "fail"}">expected ${escapeHtml(
          s.expected ?? "?",
        )}, got ${escapeHtml(s.actual ?? "?")}</span>`;

  const statusClass = s.status === "completed" ? "ok" : s.status === "failed" ? "fail" : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(s.scenario)} — ${escapeHtml(s.runId)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
  ${
    options.backHref === undefined
      ? ""
      : `<p class="sub"><a href="${escapeHtml(options.backHref)}">← all runs</a></p>`
  }
  <h1>${escapeHtml(s.scenario)}</h1>
  <p class="sub">run <code>${escapeHtml(s.runId)}</code> · started ${escapeHtml(s.startedAt)}</p>
  <div class="pills">
    <span class="pill ${statusClass}">${escapeHtml(s.status)}</span>
    ${verdictPill}
    <span class="pill">${
      s.status === "reset"
        ? `${formatDuration(s.activeMs)} active`
        : formatDuration(s.durationMs)
    }</span>
    <span class="pill">${model.rpcCalls.length} RPC calls</span>
    ${
      model.slowestRpcMs === null
        ? ""
        : `<span class="pill">slowest ${formatDuration(model.slowestRpcMs)}</span>`
    }
  </div>
  ${s.error === null ? "" : `<div class="error-box">${escapeHtml(s.error)}</div>`}

  <h2>Topology</h2>
  <div class="panel">${renderGraph(model)}</div>

  <h2>Steps</h2>
  ${renderTimeline(model)}

  <h2>RPC calls</h2>
  ${renderRpcTable(model)}

  <footer>
    Generated by <code>fiber-lab logs ${escapeHtml(s.runId)} --html</code>.
    Read-only: this report is rendered from the run-log alone and never contacted a node.
  </footer>
</div>
<script id="run-data" type="application/json">${embedJson(model)}</script>
<script>${SCRIPT}</script>
${options.live === true ? `<script>${LIVE_SCRIPT}</script>` : ""}
</body>
</html>
`;
}
