import type { StepRecord } from "../runlog/store";
import { classifyFailure } from "./errorCategory";
import type { Channel, ErrorCategory, Scenario } from "./schema";

export interface RouteHopsResult {
  expected: number;
  actual: number | null;
  match: boolean;
}

export interface ReasonResult {
  expected: ErrorCategory;
  actual: ErrorCategory | null;
  match: boolean;
}

export interface ExpectationResult {
  match: boolean;
  expected: "succeeded" | "failed";
  actual: "succeeded" | "failed";
  routeHops?: RouteHopsResult;
  reason?: ReasonResult;
}

/** Số hop trung gian ngắn nhất giữa 2 node trên đồ thị channel (vô hướng) — edges-1, hoặc null nếu không có path. */
function hopsBetween(channels: Channel[], from: string, to: string): number | null {
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => adj.set(a, [...(adj.get(a) ?? []), b]);
  for (const c of channels) {
    link(c.from, c.to);
    link(c.to, c.from);
  }
  const queue: [string, number][] = [[from, 0]];
  const seen = new Set([from]);
  while (queue.length > 0) {
    const [node, edges] = queue.shift()!;
    if (node === to) return Math.max(0, edges - 1);
    for (const next of adj.get(node) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push([next, edges + 1]);
      }
    }
  }
  return null;
}

/** routeHops: số hop từ topology, đối chiếu fee thật (qua ≥1 hop trung gian ⇒ fee > 0; direct ⇒ fee 0). */
function verifyRouteHops(scenario: Scenario, payments: StepRecord[], allSucceeded: boolean): RouteHopsResult {
  const expected = scenario.expect.routeHops!;
  const first = payments[0]!;
  const input = first.input as { from?: string; to?: string } | null;
  const actual = input?.from && input?.to ? hopsBetween(scenario.channels, input.from, input.to) : null;
  const fee = Number((first.result as { fee?: string } | null)?.fee ?? "0");
  const feeConsistent = allSucceeded ? expected >= 1 === fee > 0 : true;
  return { expected, actual, match: actual === expected && feeConsistent };
}

/** reason: phân loại lỗi send_payment fail → ErrorCategory, so với expect.reason (chỉ khi status failed). */
function verifyReason(scenario: Scenario, payments: StepRecord[]): ReasonResult {
  const expected = scenario.expect.reason!;
  const failed = payments.find((p) => (p.result as { status?: string } | null)?.status !== "Success");
  const actual = classifyFailure(failed?.result as { error?: unknown; peerConnected?: boolean } | null);
  return { expected, actual, match: actual === expected };
}

/**
 * So khớp `expect` với kết quả các bước send_payment đã ghi: status (coarse succeeded/failed),
 * routeHops và reason (nếu khai). `match` gộp cả ba. Không có send_payment → null (không có gì để kiểm).
 */
export function verifyExpectation(scenario: Scenario, steps: StepRecord[]): ExpectationResult | null {
  const payments = steps.filter((s) => s.action === "send_payment");
  if (payments.length === 0) return null;

  const allSucceeded = payments.every((p) => (p.result as { status?: string } | null)?.status === "Success");
  const actual = allSucceeded ? "succeeded" : "failed";
  const statusMatch = actual === scenario.expect.status;

  const result: ExpectationResult = { match: statusMatch, expected: scenario.expect.status, actual };

  if (scenario.expect.routeHops !== undefined) {
    result.routeHops = verifyRouteHops(scenario, payments, allSucceeded);
    result.match &&= result.routeHops.match;
  }
  if (scenario.expect.reason !== undefined) {
    result.reason = verifyReason(scenario, payments);
    result.match &&= result.reason.match;
  }

  return result;
}
