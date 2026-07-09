import type { StepRecord } from "../runlog/store";
import type { Channel, Scenario } from "./schema";

export interface RouteHopsResult {
  expected: number;
  actual: number | null;
  match: boolean;
}

export interface ExpectationResult {
  match: boolean;
  expected: "succeeded" | "failed";
  actual: "succeeded" | "failed";
  routeHops?: RouteHopsResult;
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

/**
 * So khớp `expect` với kết quả các bước send_payment đã ghi.
 * status: coarse succeeded/failed. routeHops (nếu khai): số hop từ topology, đối chiếu fee thật
 * (payment qua ≥1 hop trung gian phải chịu phí > 0). `reason` để dành E5-4.
 */
export function verifyExpectation(scenario: Scenario, steps: StepRecord[]): ExpectationResult | null {
  const payments = steps.filter((s) => s.action === "send_payment");
  if (payments.length === 0) return null;

  const allSucceeded = payments.every((p) => (p.result as { status?: string } | null)?.status === "Success");
  const actual = allSucceeded ? "succeeded" : "failed";
  const statusMatch = actual === scenario.expect.status;

  if (scenario.expect.routeHops === undefined) {
    return { match: statusMatch, expected: scenario.expect.status, actual };
  }

  const expected = scenario.expect.routeHops;
  const first = payments[0]!;
  const input = first.input as { from?: string; to?: string } | null;
  const hops = input?.from && input?.to ? hopsBetween(scenario.channels, input.from, input.to) : null;

  // Đối chiếu runtime: qua hop trung gian ⇒ fee > 0 (phí định tuyến); direct ⇒ fee 0.
  const fee = Number((first.result as { fee?: string } | null)?.fee ?? "0");
  const feeConsistent = allSucceeded ? expected >= 1 === fee > 0 : true;
  const hopMatch = hops === expected && feeConsistent;

  return {
    match: statusMatch && hopMatch,
    expected: scenario.expect.status,
    actual,
    routeHops: { expected, actual: hops, match: hopMatch },
  };
}
