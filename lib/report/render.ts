import {
  formatAmount,
  type ReportEdge,
  type ReportModel,
  type ReportNode,
  type ReportStep,
} from "./model";

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

/* ── Colour ────────────────────────────────────────────────────────────────────
 * Colour follows the NODE, never its side of an edge: if blue meant "the left end",
 * alice would change colour from one channel to the next. A node keeps its hue in the
 * graph, in the balance split and in the tables, so "whose money is where" is readable
 * at a glance. Slots are assigned in fixed order and never cycled.
 *
 * Validated with the dataviz validator, all pairs, both modes: worst CVD ΔE 9.2 light /
 * 9.4 dark, worst normal-vision ΔE 24.0 / 20.9. Aqua sits at 2.74:1 on the light surface,
 * so the relief rule applies — every amount is direct-labelled and repeated as text in the
 * channels table.
 */
const SERIES_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const SERIES_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

const cssName = (name: string): string => name.replace(/[^a-zA-Z0-9_-]/g, "_");
const nodeColor = (name: string): string => `var(--node-${cssName(name)}, var(--muted))`;

const seriesVars = (nodes: ReportNode[], palette: string[]): string =>
  nodes
    .map((node, i) => `--node-${cssName(node.name)}: ${palette[i % palette.length]};`)
    .join("\n      ");

/* ── Topology ───────────────────────────────────────────────────────────────── */

const NODE_RADIUS = 26;
const EDGE_WIDTH = 8;
const GRAPH_PADDING = 90;
const SPACING = 230;
/* The viewBox is sized to the ink, not padded out: the svg scales to the panel width, so every
 * spare unit of height becomes dead space on screen. Content runs from the amount labels
 * (baseline CENTER_Y - 15, ascending ~9) down to the state label (baseline CENTER_Y + 26). */
const CENTER_Y = 44;
const GRAPH_HEIGHT = 80;

type Positions = Map<string, { x: number; y: number }>;

function nodePositions(nodes: ReportNode[]): Positions {
  const positions: Positions = new Map();
  nodes.forEach((node, index) => {
    positions.set(node.name, { x: GRAPH_PADDING + SPACING * index, y: CENTER_Y });
  });
  return positions;
}

function splitRatio(edge: ReportEdge): number {
  try {
    const a = BigInt(edge.aBalance ?? "0");
    const total = a + BigInt(edge.bBalance ?? "0");
    if (total === 0n) return 0.5;
    return Number((a * 1000n) / total) / 1000;
  } catch {
    return 0.5;
  }
}

/** One channel: two segments, each in the colour of the node whose balance it is, split where
 *  the liquidity actually sits, with a 2px surface gap between them and both amounts labelled
 *  at their own end. */
function renderEdge(edge: ReportEdge, positions: Positions, animate: boolean): string {
  const a = positions.get(edge.a);
  const b = positions.get(edge.b);
  if (!a || !b) return "";

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const inset = NODE_RADIUS / length;
  const gap = 1 / length; // half of a 2px gap, in path units
  const at = (t: number) => ({ x: a.x + dx * t, y: a.y + dy * t });

  const ratio = inset + splitRatio(edge) * (1 - inset * 2);
  const start = at(inset);
  const end = at(1 - inset);
  const localEnd = at(Math.max(ratio - gap, inset));
  const remoteStart = at(Math.min(ratio + gap, 1 - inset));

  const tip = `${edge.a} ${formatAmount(edge.aBalance, edge.asset)} · ${edge.b} ${formatAmount(
    edge.bBalance,
    edge.asset,
  )} · ${edge.state}`;

  const flow =
    animate && edge.onPaymentPath
      ? `<circle r="4.5" class="flow">
          <animateMotion dur="1.6s" repeatCount="indefinite"
            path="M ${start.x} ${start.y} L ${end.x} ${end.y}" />
        </circle>`
      : "";

  return `
      <g class="edge${edge.onPaymentPath ? " on-path" : ""}" data-tip="${escapeHtml(tip)}">
        <line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" class="edge-track" />
        <line x1="${start.x}" y1="${start.y}" x2="${localEnd.x}" y2="${localEnd.y}"
              class="edge-fill" stroke="${nodeColor(edge.a)}" />
        <line x1="${remoteStart.x}" y1="${remoteStart.y}" x2="${end.x}" y2="${end.y}"
              class="edge-fill" stroke="${nodeColor(edge.b)}" />
        <text x="${start.x + 4}" y="${start.y - 15}" class="edge-amount" text-anchor="start">${escapeHtml(
          formatAmount(edge.aBalance, edge.asset),
        )}</text>
        <text x="${end.x - 4}" y="${end.y - 15}" class="edge-amount" text-anchor="end">${escapeHtml(
          formatAmount(edge.bBalance, edge.asset),
        )}</text>
        <text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 + 26}" class="edge-state"
              text-anchor="middle">${escapeHtml(edge.state)}</text>
        ${flow}
      </g>`;
}

const renderEdges = (edges: ReportEdge[], positions: Positions, animate: boolean): string =>
  edges.map((edge) => renderEdge(edge, positions, animate)).join("");

const renderNodes = (nodes: ReportNode[], positions: Positions): string =>
  nodes
    .map((node) => {
      const p = positions.get(node.name)!;
      return `
      <g class="node">
        <circle cx="${p.x}" cy="${p.y}" r="${NODE_RADIUS}" stroke="${nodeColor(node.name)}" />
        <text x="${p.x}" y="${p.y + 5}" class="node-label">${escapeHtml(node.name)}</text>
      </g>`;
    })
    .join("");

/** The scrubber's frames: one per step that recorded a snapshot, so the run can be walked and
 *  the liquidity watched as it moves. Markup is precomputed here rather than redrawn in the
 *  browser — the geometry stays in one place and the scrubber only swaps innerHTML. */
function graphFrames(model: ReportModel, positions: Positions): { label: string; svg: string }[] {
  const frames = model.steps
    .filter((step) => step.edges.length > 0)
    .map((step) => ({
      label: `${step.action} · ${step.summary}`,
      svg: renderEdges(step.edges, positions, step.action === "send_payment"),
    }));
  if (frames.length === 0 && model.edges.length > 0) {
    frames.push({ label: "final state", svg: renderEdges(model.edges, positions, true) });
  }
  return frames;
}

function renderTopology(model: ReportModel, nodes: ReportNode[], positions: Positions): string {
  if (nodes.length === 0) return `<p class="empty">This run recorded no nodes.</p>`;

  const width = GRAPH_PADDING * 2 + SPACING * Math.max(nodes.length - 1, 0);
  const frames = graphFrames(model, positions);

  if (model.edges.length === 0 && frames.length === 0) {
    return `<p class="empty">No channel snapshot was recorded for this run — it predates the
      <code>channels</code> field, or no channel was opened.</p>
      <svg viewBox="0 0 ${width} ${GRAPH_HEIGHT}" class="graph" role="img"
           aria-label="Nodes, with no channels recorded">${renderNodes(nodes, positions)}</svg>`;
  }

  const legend = nodes
    .map(
      (node) =>
        `<span class="key"><i style="background:${nodeColor(node.name)}"></i>${escapeHtml(
          node.name,
        )}</span>`,
    )
    .join("");

  const last = frames.length - 1;
  const scrubber =
    frames.length > 1
      ? `<div class="scrubber">
          <button type="button" id="frame-prev" aria-label="Previous snapshot">‹</button>
          <input type="range" id="frame-range" min="0" max="${last}" value="${last}"
                 aria-label="Step through the run's snapshots" />
          <button type="button" id="frame-next" aria-label="Next snapshot">›</button>
          <span id="frame-label" class="frame-label">${escapeHtml(frames[last]!.label)}</span>
        </div>`
      : "";

  return `
    <div class="legend-row">${legend}
      <span class="legend-note">colour = the node holding that balance</span></div>
    <svg viewBox="0 0 ${width} ${GRAPH_HEIGHT}" class="graph" role="img"
         aria-label="Channel topology">
      <g id="graph-edges">${renderEdges(model.edges, positions, true)}</g>
      ${renderNodes(nodes, positions)}
    </svg>
    ${scrubber}`;
}

/** The table view the relief rule asks for: the same balances as text, for anyone the colour
 *  split does not reach. */
function renderChannelTable(model: ReportModel): string {
  if (model.edges.length === 0) return "";
  const rows = model.edges
    .map(
      (edge) => `
      <tr>
        <td><span class="swatch" style="background:${nodeColor(edge.a)}"></span>${escapeHtml(
          edge.a,
        )} → <span class="swatch" style="background:${nodeColor(edge.b)}"></span>${escapeHtml(
        edge.b,
      )}</td>
        <td class="num">${escapeHtml(formatAmount(edge.aBalance, edge.asset))}</td>
        <td class="num">${escapeHtml(formatAmount(edge.bBalance, edge.asset))}</td>
        <td>${escapeHtml(edge.state)}</td>
        <td>${edge.onPaymentPath ? "on path" : "—"}</td>
      </tr>`,
    )
    .join("");

  return `
    <table class="data">
      <caption>Final channel balances</caption>
      <thead><tr><th>channel</th><th>local</th><th>remote</th><th>state</th><th>payment</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/* ── Tiles, timeline, RPC ───────────────────────────────────────────────────── */

const tile = (label: string, value: string, klass = ""): string =>
  `<div class="tile ${klass}">
      <span class="tile-value">${escapeHtml(value)}</span>
      <span class="tile-label">${escapeHtml(label)}</span>
    </div>`;

function renderTiles(model: ReportModel): string {
  const s = model.summary;
  const statusClass = s.status === "completed" ? "good" : s.status === "failed" ? "critical" : "";
  const verdict =
    s.verdict === "unknown"
      ? ""
      : tile(
          "expectation",
          s.verdict === "match" ? `${s.expected} ✓` : `${s.expected} → ${s.actual}`,
          s.verdict === "match" ? "good" : "critical",
        );

  return `<div class="tiles">
    ${tile("status", s.status, statusClass)}
    ${verdict}
    ${tile(
      s.status === "reset" ? "active" : "duration",
      formatDuration(s.status === "reset" ? s.activeMs : s.durationMs),
    )}
    ${tile("rpc calls", String(model.rpcCalls.length))}
    ${model.slowestRpcMs === null ? "" : tile("slowest call", formatDuration(model.slowestRpcMs))}
  </div>`;
}

function renderTimeline(model: ReportModel): string {
  if (model.steps.length === 0) return `<p class="empty">This run recorded no steps.</p>`;
  const span = Math.max(...model.steps.map((s) => s.offsetMs + (s.durationMs ?? 0)), 1);

  const row = (step: ReportStep): string => {
    const left = (step.offsetMs / span) * 100;
    const width = Math.max(((step.durationMs ?? 0) / span) * 100, 0.8);
    const klass = step.running ? "step running" : step.ok ? "step" : "step failed";
    // Status never rides on colour alone: every row carries its own glyph and its text.
    const icon = step.running ? "◌" : step.ok ? "✓" : "✕";
    return `
      <li class="${klass}">
        <div class="step-head">
          <span class="step-icon" aria-hidden="true">${icon}</span>
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
        ${step.progress === null ? "" : `<p class="step-progress">${escapeHtml(step.progress)}</p>`}
      </li>`;
  };

  return `<ol class="timeline">${model.steps.map(row).join("")}</ol>`;
}

function renderRpcTable(model: ReportModel): string {
  if (model.rpcCalls.length === 0) return `<p class="empty">This run recorded no RPC calls.</p>`;

  const slowest = model.slowestRpcMs ?? 0;
  const nodeOptions = [...new Set(model.rpcCalls.map((c) => c.node))]
    .sort()
    .map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`)
    .join("");
  const methodOptions = model.methods
    .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
    .join("");

  const rows = model.rpcCalls
    .map((call) => {
      const width = slowest > 0 && call.durationMs !== null ? (call.durationMs / slowest) * 100 : 0;
      const latency =
        call.durationMs === null
          ? `<span class="muted">—</span>`
          : `<span class="lat"><span class="lat-bar" style="width:${width.toFixed(1)}%"
              data-tip="${escapeHtml(
                `${call.method} on ${call.node}: ${formatDuration(call.durationMs)}`,
              )}"></span><span class="lat-value">${formatDuration(call.durationMs)}</span></span>`;
      return `
      <tr class="rpc-row${call.ok ? "" : " failed"}" data-node="${escapeHtml(
        call.node,
      )}" data-method="${escapeHtml(call.method)}" data-ok="${call.ok}" data-index="${call.index}">
        <td class="num">+${formatDuration(call.offsetMs)}</td>
        <td><span class="swatch" style="background:${nodeColor(call.node)}"></span>${escapeHtml(
          call.node,
        )}</td>
        <td class="method">${escapeHtml(call.method)}</td>
        <td class="lat-cell">${latency}</td>
        <td>${call.ok ? "ok" : `✕ ${escapeHtml(call.errorMessage ?? "error")}`}</td>
      </tr>
      <tr class="detail" data-detail="${call.index}" hidden>
        <td colspan="5"><pre></pre></td>
      </tr>`;
    })
    .join("");

  return `
    <div class="filters">
      <input type="search" id="rpc-search" placeholder="Filter by method, node or error…" />
      <select id="rpc-node"><option value="">every node</option>${nodeOptions}</select>
      <select id="rpc-method"><option value="">every method</option>${methodOptions}</select>
      <label class="check"><input type="checkbox" id="rpc-errors" /> errors only</label>
      <span id="rpc-count" class="count"></span>
    </div>
    <table class="data rpc">
      <thead>
        <tr><th>at</th><th>node</th><th>method</th><th>took</th><th>result</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="legend-note">Click a row for the raw params and response.</p>`;
}

/* ── Styles ─────────────────────────────────────────────────────────────────── */

const STYLES = `
  :root {
    color-scheme: light;
    --surface: #fcfcfb;
    --plane: #f9f9f7;
    --text: #0b0b0b;
    --text-2: #52514e;
    --muted: #898781;
    --grid: #e1e0d9;
    --axis: #c3c2b7;
    --border: rgba(11, 11, 11, 0.10);
    --good: #0ca30c;
    --critical: #d03b3b;
    --warning: #fab219;
    --accent: #2a78d6;
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) {
      color-scheme: dark;
      --surface: #1a1a19;
      --plane: #0d0d0d;
      --text: #ffffff;
      --text-2: #c3c2b7;
      --grid: #2c2c2a;
      --axis: #383835;
      --border: rgba(255, 255, 255, 0.10);
      --accent: #3987e5;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --surface: #1a1a19;
    --plane: #0d0d0d;
    --text: #ffffff;
    --text-2: #c3c2b7;
    --grid: #2c2c2a;
    --axis: #383835;
    --border: rgba(255, 255, 255, 0.10);
    --accent: #3987e5;
  }

  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 28px 16px 72px; background: var(--plane); color: var(--text);
    font: 14px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .wrap { max-width: 1060px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 2px; letter-spacing: -0.01em; }
  h2 {
    font-size: 12px; margin: 34px 0 12px; text-transform: uppercase;
    letter-spacing: .08em; color: var(--muted); font-weight: 600;
  }
  a { color: var(--accent); }
  code, pre, .method, .num, .lat-value { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .num, .lat-value { font-variant-numeric: tabular-nums; }
  .sub { color: var(--text-2); margin: 0 0 18px; font-size: 13px; }
  .muted { color: var(--muted); }

  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 10px; }
  .tile {
    background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
    padding: 12px 14px; display: flex; flex-direction: column; gap: 2px;
  }
  .tile-value { font-size: 19px; font-weight: 600; letter-spacing: -0.01em; }
  .tile-label { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); }
  .tile.good .tile-value { color: var(--good); }
  .tile.critical .tile-value { color: var(--critical); }

  .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 18px; }
  .error-box {
    border-left: 3px solid var(--critical); padding: 10px 14px; margin: 14px 0;
    background: var(--surface); white-space: pre-wrap; border-radius: 0 8px 8px 0;
  }
  .empty, .legend-note { color: var(--muted); font-size: 12.5px; }

  .legend-row { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; margin-bottom: 4px; }
  .key { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-2); }
  .key i, .swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; flex: none; }
  .swatch { margin-right: 6px; vertical-align: -1px; }

  .graph { width: 100%; height: auto; display: block; }
  .node circle { fill: var(--surface); stroke-width: 2; }
  .node-label { text-anchor: middle; font-size: 13px; fill: var(--text); font-weight: 600; }
  .edge-track { stroke: var(--grid); stroke-width: ${EDGE_WIDTH}; stroke-linecap: round; }
  .edge-fill { stroke-width: ${EDGE_WIDTH}; stroke-linecap: round; }
  .edge:hover .edge-track, .on-path .edge-track { stroke: var(--axis); }
  .edge-amount { font-size: 11.5px; fill: var(--text-2); font-variant-numeric: tabular-nums; }
  .edge-state { font-size: 11px; fill: var(--muted); }
  .flow { fill: var(--text); stroke: var(--surface); stroke-width: 2; }

  .scrubber { display: flex; align-items: center; gap: 10px; margin-top: 14px; }
  .scrubber input[type=range] { flex: 1; accent-color: var(--accent); }
  .scrubber button {
    border: 1px solid var(--border); background: var(--plane); color: var(--text);
    border-radius: 6px; width: 28px; height: 28px; cursor: pointer; font-size: 15px; line-height: 1;
  }
  .scrubber button:hover { border-color: var(--axis); }
  .frame-label { font-size: 12.5px; color: var(--text-2); min-width: 190px; }

  .timeline { list-style: none; margin: 0; padding: 0; }
  .step { border-bottom: 1px solid var(--border); padding: 11px 0; }
  .step-head { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  .step-icon { color: var(--good); font-size: 12px; }
  .step.failed .step-icon { color: var(--critical); }
  .step.running .step-icon { color: var(--warning); animation: pulse 1s ease-in-out infinite; }
  .step-action { font-weight: 600; font-family: ui-monospace, monospace; }
  .step-summary { color: var(--text-2); flex: 1; min-width: 170px; }
  .step-time { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .step.failed .step-action { color: var(--critical); }
  .track { position: relative; height: 6px; background: var(--grid); border-radius: 3px; margin-top: 8px; }
  .bar { position: absolute; top: 0; height: 6px; border-radius: 3px; background: var(--accent); min-width: 2px; }
  .step.failed .bar { background: var(--critical); }
  .step.running .bar { background: var(--warning); animation: pulse 1.4s ease-in-out infinite; }
  .step-progress { margin: 7px 0 0; font-size: 12px; color: var(--muted); font-family: ui-monospace, monospace; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
  @media (prefers-reduced-motion: reduce) {
    .step.running .bar, .step.running .step-icon { animation: none; }
    .flow { display: none; }
  }

  .filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
  .filters input[type=search], .filters select {
    background: var(--surface); color: var(--text); border: 1px solid var(--border);
    border-radius: 7px; padding: 6px 9px; font: inherit;
  }
  .filters input[type=search] { flex: 1; min-width: 200px; }
  .check { font-size: 13px; color: var(--text-2); display: inline-flex; align-items: center; gap: 5px; }
  .count { color: var(--muted); font-size: 12px; }

  table.data { width: 100%; border-collapse: collapse; }
  table.data caption { text-align: left; color: var(--muted); font-size: 12px; padding: 14px 0 8px; }
  table.data th {
    text-align: left; font-size: 11.5px; color: var(--muted); font-weight: 600;
    border-bottom: 1px solid var(--axis); padding: 7px 8px;
  }
  table.data td { padding: 6px 8px; border-bottom: 1px solid var(--border); }
  .rpc-row td { cursor: pointer; }
  .rpc-row:hover td { background: var(--plane); }
  .rpc-row.failed td { color: var(--critical); }
  .num { text-align: right; white-space: nowrap; }
  .lat-cell { width: 170px; }
  .lat { display: flex; align-items: center; gap: 8px; }
  .lat-bar { height: 6px; border-radius: 3px; background: var(--accent); min-width: 2px; flex: none; max-width: 90px; }
  .lat-value { font-size: 12px; color: var(--text-2); }
  .detail pre {
    margin: 0; padding: 12px; background: var(--plane); border-radius: 8px;
    overflow-x: auto; font-size: 12px;
  }

  #tip {
    position: fixed; z-index: 10; pointer-events: none; opacity: 0;
    background: var(--text); color: var(--surface); padding: 5px 9px; border-radius: 6px;
    font-size: 12px; max-width: 320px; transition: opacity .1s;
  }
  footer { margin-top: 44px; color: var(--muted); font-size: 12px; }
  @media (max-width: 620px) {
    body { padding: 16px 16px 48px; }
    .step-time { width: 100%; }
    .lat-cell { width: auto; }
    .frame-label { display: none; }
  }
`;

/* ── Client script ──────────────────────────────────────────────────────────── */

const SCRIPT = `
  const model = JSON.parse(document.getElementById("run-data").textContent);
  const frames = JSON.parse(document.getElementById("graph-frames").textContent);
  const rpcByIndex = new Map(model.rpcCalls.map((c) => [c.index, c]));

  /* One hover layer for every mark that carries data-tip. */
  const tip = document.getElementById("tip");
  document.addEventListener("mouseover", (e) => {
    const target = e.target.closest ? e.target.closest("[data-tip]") : null;
    if (!target) return;
    tip.textContent = target.getAttribute("data-tip");
    tip.style.opacity = "1";
  });
  document.addEventListener("mousemove", (e) => {
    if (tip.style.opacity !== "1") return;
    tip.style.left = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8) + "px";
    tip.style.top = Math.max(e.clientY - tip.offsetHeight - 14, 8) + "px";
  });
  document.addEventListener("mouseout", () => { tip.style.opacity = "0"; });

  /* Scrubber — walk the run and watch the liquidity move. */
  const range = document.getElementById("frame-range");
  if (range) {
    const edgeGroup = document.getElementById("graph-edges");
    const label = document.getElementById("frame-label");
    const show = (i) => {
      const frame = frames[i];
      if (!frame) return;
      edgeGroup.innerHTML = frame.svg;
      label.textContent = frame.label;
      range.value = String(i);
    };
    const step = (delta) => show(Math.min(Math.max(Number(range.value) + delta, 0), frames.length - 1));
    range.addEventListener("input", () => show(Number(range.value)));
    document.getElementById("frame-prev").addEventListener("click", () => step(-1));
    document.getElementById("frame-next").addEventListener("click", () => step(1));
    document.addEventListener("keydown", (e) => {
      if (e.target.matches && e.target.matches("input, select, textarea")) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    });
  }

  /* RPC filters. */
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

/** Polls the run's own JSON and reloads when the model changed. Cheap, and it means the live page
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
  const statusClass = (status: string): string =>
    status === "failed" ? "critical" : status === "completed" ? "good" : "";

  const rows =
    runs.length === 0
      ? `<p class="empty">No runs in <code>.fiber-lab/runs/</code> yet — build one with
         <code>fiber-lab up &lt;scenario&gt;</code>.</p>`
      : `<table class="data">
          <thead><tr><th>run</th><th>scenario</th><th>status</th><th>started</th><th>steps</th></tr></thead>
          <tbody>${runs
            .map(
              (run) => `<tr>
              <td class="method"><a href="/run/${escapeHtml(run.runId)}">${escapeHtml(
                run.runId,
              )}</a></td>
              <td>${escapeHtml(run.scenario)}</td>
              <td class="${statusClass(run.status)}">${escapeHtml(run.status)}</td>
              <td>${escapeHtml(run.startedAt)}</td>
              <td class="num">${run.steps}</td>
            </tr>`,
            )
            .join("")}</tbody>
        </table>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>fiber-lab runs</title>
<style>${STYLES}
  td.good { color: var(--good); }
  td.critical { color: var(--critical); }
</style>
</head>
<body>
<div class="wrap">
  <h1>fiber-lab runs</h1>
  <p class="sub">Read from <code>.fiber-lab/runs/</code>. This page never contacts a node.</p>
  <div class="panel">${rows}</div>
</div>
<script>
  // Swap the table in place: a full-page refresh flickers and loses the scroll position.
  setInterval(async () => {
    try {
      const res = await fetch(location.pathname, { cache: "no-store" });
      if (!res.ok) return;
      const fresh = new DOMParser().parseFromString(await res.text(), "text/html").querySelector(".panel");
      const current = document.querySelector(".panel");
      if (fresh && current && fresh.innerHTML !== current.innerHTML) current.innerHTML = fresh.innerHTML;
    } catch (e) {
      /* the server went away — keep showing the last list */
    }
  }, 2000);
</script>
</body>
</html>
`;
}

export function renderReport(model: ReportModel, options: RenderOptions = {}): string {
  const s = model.summary;
  const nodes = model.nodes.filter((n) => !n.isChain);
  const positions = nodePositions(nodes);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(s.scenario)} — ${escapeHtml(s.runId)}</title>
<style>${STYLES}
  :root {
      ${seriesVars(nodes, SERIES_LIGHT)}
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) {
      ${seriesVars(nodes, SERIES_DARK)}
    }
  }
  :root[data-theme="dark"] {
      ${seriesVars(nodes, SERIES_DARK)}
  }
</style>
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
  ${renderTiles(model)}
  ${s.error === null ? "" : `<div class="error-box">${escapeHtml(s.error)}</div>`}

  <h2>Topology</h2>
  <div class="panel">
    ${renderTopology(model, nodes, positions)}
    ${renderChannelTable(model)}
  </div>

  <h2>Steps</h2>
  ${renderTimeline(model)}

  <h2>RPC calls</h2>
  ${renderRpcTable(model)}

  <footer>
    Generated by <code>fiber-lab logs ${escapeHtml(s.runId)} --html</code>.
    Read-only: rendered from the run-log alone, never in contact with a node.
  </footer>
</div>
<div id="tip" role="tooltip"></div>
<script id="run-data" type="application/json">${embedJson(model)}</script>
<script id="graph-frames" type="application/json">${embedJson(graphFrames(model, positions))}</script>
<script>${SCRIPT}</script>
${options.live === true ? `<script>${LIVE_SCRIPT}</script>` : ""}
</body>
</html>
`;
}
