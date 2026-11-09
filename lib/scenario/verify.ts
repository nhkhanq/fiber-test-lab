import type { StepRecord } from "../runlog/store";
import { paymentState, type CheckResult, type PaymentResult } from "./assertions";
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

export interface FailedCheck {
  step: number;
  action: string;
  check: CheckResult;
}

export interface ExpectationResult {
  match: boolean;
  expected: "succeeded" | "failed" | null;
  actual: "succeeded" | "failed" | "timeout" | null;
  routeHops?: RouteHopsResult;
  reason?: ReasonResult;
  stepChecks: number;
  failedChecks: FailedCheck[];
}

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

function verifyRouteHops(expected: number, scenario: Scenario, payments: StepRecord[], allSucceeded: boolean): RouteHopsResult {
  const first = payments[0];
  const input = first?.input as { from?: string; to?: string } | null | undefined;
  const actual = input?.from && input?.to ? hopsBetween(scenario.channels, input.from, input.to) : null;
  const fee = Number((first?.result as { fee?: string } | null | undefined)?.fee ?? "0");
  const feeConsistent = allSucceeded ? expected >= 1 === fee > 0 : true;
  return { expected, actual, match: actual === expected && feeConsistent };
}

function verifyReason(expected: ErrorCategory, payments: StepRecord[]): ReasonResult {
  const failed = payments.find((p) => (p.result as { status?: string } | null)?.status !== "Success");
  const actual = classifyFailure(failed?.result as Parameters<typeof classifyFailure>[0]);
  return { expected, actual, match: actual === expected };
}

export function verifyExpectation(scenario: Scenario, steps: StepRecord[]): ExpectationResult | null {
  const checked = steps.flatMap((step, index) =>
    (step.checks ?? []).map((check) => ({ step: index, action: step.action, check })),
  );
  const failedChecks = checked.filter((c) => !c.check.match);
  const expect = scenario.expect;
  if (expect === undefined && checked.length === 0) return null;

  const result: ExpectationResult = {
    match: failedChecks.length === 0,
    expected: expect?.status ?? null,
    actual: null,
    stepChecks: checked.length,
    failedChecks,
  };
  if (expect === undefined) return result;

  const payments = steps.filter((s) => s.action === "send_payment");
  if (payments.length === 0) {
    result.match = false;
    return result;
  }

  const states = payments.map((p) => paymentState(p.result as PaymentResult | null));
  const allSucceeded = states.every((s) => s === "succeeded");
  result.actual = allSucceeded ? "succeeded" : states.includes("timeout") ? "timeout" : "failed";
  result.match &&= result.actual === expect.status;

  if (expect.routeHops !== undefined) {
    result.routeHops = verifyRouteHops(expect.routeHops, scenario, payments, allSucceeded);
    result.match &&= result.routeHops.match;
  }
  if (expect.reason !== undefined) {
    result.reason = verifyReason(expect.reason, payments);
    result.match &&= result.reason.match;
  }

  return result;
}

export function describeMismatch(result: ExpectationResult): string[] {
  const lines: string[] = [];
  if (result.expected !== null && result.expected !== result.actual) {
    lines.push(`scenario: expected ${result.expected} but got ${result.actual ?? "no payment"}`);
  }
  if (result.reason && !result.reason.match) {
    lines.push(`scenario: expected reason ${result.reason.expected} but got ${result.reason.actual ?? "unknown"}`);
  }
  if (result.routeHops && !result.routeHops.match) {
    lines.push(`scenario: expected ${result.routeHops.expected} route hop(s) but got ${result.routeHops.actual ?? "no route"}`);
  }
  for (const failed of result.failedChecks) {
    lines.push(`steps[${failed.step}] ${failed.action}: ${failed.check.check} expected ${failed.check.expected} but got ${failed.check.actual}`);
  }
  return lines;
}
