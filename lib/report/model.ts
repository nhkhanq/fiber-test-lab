import { CKB_SERVICE, SHANNON_PER_CKB, UDT_ASSET } from "../constants";
import type { ChannelSnapshot, RunLog, RpcRecord, StepRecord } from "../runlog/store";

/** A pure RunLog -> view-model transform. No I/O, no RPC: the run viewer is read-only and the
 *  run-log is its only source (after `reset` the containers are gone — see decisions-log 2026-09-22). */

export interface ReportSummary {
  runId: string;
  scenario: string;
  status: RunLog["status"];
  startedAt: string;
  finishedAt: string | null;
  /** startedAt -> finishedAt: the run's whole lifetime, which for a reset run includes the
   *  hours it sat idle before somebody cleaned it up. */
  durationMs: number | null;
  /** startedAt -> the last recorded step: how long the run actually took to build and execute. */
  activeMs: number | null;
  error: string | null;
  verdict: "match" | "mismatch" | "unknown";
  expected: string | null;
  actual: string | null;
}

export interface ReportNode {
  name: string;
  container: string | null;
  endpoint: string | null;
  isChain: boolean;
}

export interface ReportEdge {
  channelId: string;
  a: string;
  b: string;
  aBalance: string | null;
  bBalance: string | null;
  asset: string;
  state: string;
  onPaymentPath: boolean;
}

export interface ReportStep {
  index: number;
  action: string;
  at: string;
  offsetMs: number;
  durationMs: number | null;
  ok: boolean;
  running: boolean;
  /** What the step is doing right now, while it runs (a compose progress line, a stage name). */
  progress: string | null;
  input: unknown;
  result: unknown;
  summary: string;
  channels: ChannelSnapshot[];
}

export interface ReportRpc {
  index: number;
  node: string;
  method: string;
  at: string;
  offsetMs: number;
  durationMs: number | null;
  ok: boolean;
  params: unknown;
  response: unknown;
  error: unknown;
  errorMessage: string | null;
}

export interface ReportModel {
  /** Changes whenever anything a reader can see changes — the live page reloads on a new value.
   *  Step counts alone are not enough: a running step's progress changes without adding a step. */
  fingerprint: string;
  summary: ReportSummary;
  nodes: ReportNode[];
  edges: ReportEdge[];
  steps: ReportStep[];
  rpcCalls: ReportRpc[];
  methods: string[];
  slowestRpcMs: number | null;
}

const ms = (from: string, to: string): number => Date.parse(to) - Date.parse(from);

/** Base units -> a human amount. CKB is shannon-denominated; a UDT amount is already in its own unit. */
export function formatAmount(raw: string | null, asset: string): string {
  if (raw === null) return "—";
  let value: bigint;
  try {
    value = BigInt(raw);
  } catch {
    return raw;
  }
  if (asset === UDT_ASSET) return `${value.toString()} ${asset}`;

  const whole = value / SHANNON_PER_CKB;
  const fraction = value % SHANNON_PER_CKB;
  if (fraction === 0n) return `${whole} CKB`;
  const decimals = fraction.toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole}.${decimals} CKB`;
}

function stepProgress(step: StepRecord): string | null {
  const result = step.result as Record<string, unknown> | null;
  if (result === null || typeof result !== "object") return null;
  if (typeof result.stage === "string") return result.stage;
  if (typeof result.latest === "string") return result.latest;
  if (Array.isArray(result.pending) && Array.isArray(result.ready)) {
    const total = result.pending.length + result.ready.length;
    return `${result.ready.length}/${total} healthy`;
  }
  if (typeof result.status === "string" && result.status === "Inflight") return "payment inflight";
  return null;
}

function stepOk(step: StepRecord): boolean {
  const result = step.result as Record<string, unknown> | null;
  if (result === null || typeof result !== "object") return true;
  if ("error" in result) return false;
  if (result.status === "Failed") return false;
  if (result.match === false) return false;
  return true;
}

function describeStep(step: StepRecord): string {
  const input = (step.input ?? {}) as Record<string, unknown>;
  const result = (step.result ?? {}) as Record<string, unknown>;
  switch (step.action) {
    case "docker_up": {
      const services = Array.isArray(input.services) ? input.services.length : 0;
      if (step.status === "running") return stepProgress(step) ?? `starting ${services} services`;
      return `${result.imagesBuilt ?? 0} images built, ${result.containersStarted ?? 0} containers started`;
    }
    case "wait_ready": {
      const containers = Array.isArray(input.containers) ? input.containers.length : 0;
      if (step.status === "running") return stepProgress(step) ?? "waiting for health checks";
      return typeof result.error === "string" ? "timed out" : `${containers} containers healthy`;
    }
    case "open_channel":
      return `${input.from} → ${input.to}, ${input.capacity} ${input.asset ?? "CKB"}`;
    case "send_payment": {
      const head = `${input.from} → ${input.to}, ${input.amount} ${input.asset ?? "CKB"}`;
      if (typeof result.error === "string") return `${head} — failed`;
      return typeof result.status === "string" ? `${head} — ${result.status}` : head;
    }
    case "new_invoice":
      return `${input.to} invoices ${input.amount} CKB`;
    case "wait":
      return `${input.durationSec}s`;
    case "kill_node":
    case "start_node":
      return String(input.node ?? "");
    case "expect":
      return `expected ${result.expected}, got ${result.actual}`;
    case "mint_udt":
      return `${input.node}: ${input.amount} ${input.asset}`;
    default:
      return "";
  }
}

function errorMessageOf(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const e = error as Record<string, unknown>;
    if (typeof e.message === "string") return e.message;
  }
  return JSON.stringify(error);
}

/** Pair the two per-node views of a channel into one edge. Both sides report the same
 *  `channel_id`, so a node's `remoteBalance` can be corrected with the peer's own `localBalance`. */
function buildEdges(snapshots: ChannelSnapshot[]): ReportEdge[] {
  const byChannel = new Map<string, ChannelSnapshot[]>();
  for (const snap of snapshots) {
    const views = byChannel.get(snap.channelId);
    if (views) views.push(snap);
    else byChannel.set(snap.channelId, [snap]);
  }

  const edges: ReportEdge[] = [];
  for (const [channelId, views] of byChannel) {
    const primary = views[0]!;
    const b = primary.peer;
    if (b === null) continue; // a peer outside the scenario — nothing to draw it against
    const counterpart = views.find((v) => v.node === b);
    edges.push({
      channelId,
      a: primary.node,
      b,
      aBalance: primary.localBalance,
      bBalance: counterpart?.localBalance ?? primary.remoteBalance,
      asset: primary.asset,
      state: counterpart?.state ?? primary.state,
      onPaymentPath: false,
    });
  }
  return edges;
}

/** Shortest path over the channel graph — what the payment most plausibly took.
 *  FNN does not report the chosen route, so this is a reconstruction, not ground truth. */
function markPaymentPath(edges: ReportEdge[], from: string, to: string): void {
  const neighbours = new Map<string, { node: string; edge: ReportEdge }[]>();
  const link = (x: string, y: string, edge: ReportEdge) => {
    const list = neighbours.get(x);
    if (list) list.push({ node: y, edge });
    else neighbours.set(x, [{ node: y, edge }]);
  };
  for (const edge of edges) {
    link(edge.a, edge.b, edge);
    link(edge.b, edge.a, edge);
  }

  const cameFrom = new Map<string, { node: string; edge: ReportEdge }>();
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === to) break;
    for (const next of neighbours.get(current) ?? []) {
      if (seen.has(next.node)) continue;
      seen.add(next.node);
      cameFrom.set(next.node, { node: current, edge: next.edge });
      queue.push(next.node);
    }
  }
  if (!seen.has(to)) return;

  let cursor = to;
  while (cursor !== from) {
    const previous = cameFrom.get(cursor);
    if (!previous) return;
    previous.edge.onPaymentPath = true;
    cursor = previous.node;
  }
}

function buildSummary(log: RunLog): ReportSummary {
  const lastStepAt = log.steps.at(-1)?.at ?? null;
  const expectStep = [...log.steps].reverse().find((s) => s.action === "expect");
  const expectResult = (expectStep?.result ?? null) as Record<string, unknown> | null;
  return {
    runId: log.runId,
    scenario: log.scenario,
    status: log.status,
    startedAt: log.startedAt,
    finishedAt: log.finishedAt,
    durationMs: log.finishedAt === null ? null : ms(log.startedAt, log.finishedAt),
    activeMs: lastStepAt === null ? null : ms(log.startedAt, lastStepAt),
    error: log.error,
    verdict:
      expectResult === null ? "unknown" : expectResult.match === true ? "match" : "mismatch",
    expected: typeof expectResult?.expected === "string" ? expectResult.expected : null,
    actual: typeof expectResult?.actual === "string" ? expectResult.actual : null,
  };
}

function buildSteps(log: RunLog): ReportStep[] {
  return log.steps.map((step, index) => {
    // `finishedAt` closes the last step's bar — except on a reset run, where it is the moment a
    // human ran `fiber-lab reset`, often hours later. Charging that to the step would make the
    // timeline unreadable, so the last step of a reset run simply has no measured duration.
    const isLast = index === log.steps.length - 1;
    const running = step.status === "running";
    // A bracketed step knows exactly when it ended; the rest are still inferred from what follows.
    const next =
      step.endedAt ??
      (running
        ? new Date().toISOString()
        : log.steps[index + 1]?.at ?? (isLast && log.status === "reset" ? null : log.finishedAt));
    return {
      index,
      action: step.action,
      at: step.at,
      offsetMs: ms(log.startedAt, step.at),
      durationMs: next === null || next === undefined ? null : ms(step.at, next),
      ok: stepOk(step),
      running,
      progress: running ? stepProgress(step) : null,
      input: step.input,
      result: step.result,
      summary: describeStep(step),
      channels: step.channels ?? [],
    };
  });
}

function buildRpc(log: RunLog): ReportRpc[] {
  return log.rpcCalls.map((call: RpcRecord, index) => ({
    index,
    node: call.node,
    method: call.method,
    at: call.at,
    offsetMs: ms(log.startedAt, call.at),
    durationMs: call.durationMs ?? null,
    ok: call.error === null,
    params: call.params,
    response: call.response,
    error: call.error,
    errorMessage: errorMessageOf(call.error),
  }));
}

export function buildReportModel(log: RunLog): ReportModel {
  const steps = buildSteps(log);

  // The latest snapshot wins: it is the topology as the run left it.
  const lastWithChannels = [...steps].reverse().find((s) => s.channels.length > 0);
  const edges = buildEdges(lastWithChannels?.channels ?? []);

  const payment = [...log.steps].reverse().find((s) => s.action === "send_payment");
  const paymentInput = (payment?.input ?? null) as Record<string, unknown> | null;
  if (paymentInput && typeof paymentInput.from === "string" && typeof paymentInput.to === "string") {
    markPaymentPath(edges, paymentInput.from, paymentInput.to);
  }

  const rpcCalls = buildRpc(log);
  const durations = rpcCalls
    .map((c) => c.durationMs)
    .filter((d): d is number => d !== null);

  const lastStep = steps.at(-1);
  return {
    fingerprint: [
      log.status,
      steps.length,
      rpcCalls.length,
      lastStep?.running === true ? `running:${lastStep.summary}` : "idle",
    ].join("|"),
    summary: buildSummary(log),
    nodes: log.nodes.map((node) => ({
      name: node.name,
      container: node.container,
      endpoint: node.endpoint,
      isChain: node.name === CKB_SERVICE,
    })),
    edges,
    steps,
    rpcCalls,
    methods: [...new Set(rpcCalls.map((c) => c.method))].sort(),
    slowestRpcMs: durations.length > 0 ? Math.max(...durations) : null,
  };
}
