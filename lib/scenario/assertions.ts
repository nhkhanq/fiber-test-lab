import { formatBaseUnits, toBaseUnits } from "../fiber/amounts";
import type { ChannelSnapshot } from "../runlog/store";
import { classifyFailure } from "./errorCategory";
import type {
  AmountMatcher,
  Asset,
  BalanceCheck,
  ChannelCheck,
  InvoiceCheck,
  InvoiceStatus,
  OnchainCheck,
  StepExpectation,
} from "./schema";

export interface CheckResult {
  check: string;
  expected: string;
  actual: string;
  match: boolean;
}

export function matchesAmount(actual: bigint, matcher: AmountMatcher, asset: string): boolean {
  if (typeof matcher === "number") return actual === toBaseUnits(matcher, asset);
  if (matcher.min !== undefined && actual < toBaseUnits(matcher.min, asset)) return false;
  if (matcher.max !== undefined && actual > toBaseUnits(matcher.max, asset)) return false;
  return true;
}

export function describeMatcher(matcher: AmountMatcher, asset: string): string {
  const show = (value: number) => formatBaseUnits(toBaseUnits(value, asset), asset);
  if (typeof matcher === "number") return show(matcher);
  const bounds = [
    matcher.min === undefined ? null : `>= ${show(matcher.min)}`,
    matcher.max === undefined ? null : `<= ${show(matcher.max)}`,
  ];
  return bounds.filter((b) => b !== null).join(" and ");
}

function amountCheck(check: string, actual: bigint | null, matcher: AmountMatcher, asset: string): CheckResult {
  return {
    check,
    expected: describeMatcher(matcher, asset),
    actual: actual === null ? "none" : formatBaseUnits(actual, asset),
    match: actual !== null && matchesAmount(actual, matcher, asset),
  };
}

function parseAmount(value: unknown): bigint | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export interface PaymentResult {
  status?: string;
  fee?: unknown;
  error?: unknown;
  failed_error?: unknown;
  peerConnected?: boolean;
}

/** A payment that never got a hash (rejected synchronously) has no status, and has failed. */
export function paymentState(result: PaymentResult | null): "succeeded" | "failed" {
  return result?.status === "Success" ? "succeeded" : "failed";
}

export function evaluatePayment(
  expect: Pick<StepExpectation, "status" | "reason" | "fee">,
  result: PaymentResult | null,
  asset: Asset,
): CheckResult[] {
  const out: CheckResult[] = [];
  if (expect.status !== undefined) {
    const actual = paymentState(result);
    out.push({ check: "payment status", expected: expect.status, actual, match: actual === expect.status });
  }
  if (expect.reason !== undefined) {
    const actual = classifyFailure(result);
    out.push({ check: "failure reason", expected: expect.reason, actual: actual ?? "unknown", match: actual === expect.reason });
  }
  if (expect.fee !== undefined) {
    out.push(amountCheck("payment fee", parseAmount(result?.fee), expect.fee, asset));
  }
  return out;
}

interface Balances {
  local: bigint;
  remote: bigint;
}

function balancesOf(snapshots: ChannelSnapshot[], check: BalanceCheck): Balances | null {
  const channels = snapshots.filter(
    (s) => s.node === check.node && s.asset === check.asset && (check.peer === undefined || s.peer === check.peer),
  );
  if (channels.length === 0) return null;
  return channels.reduce<Balances>(
    (sum, c) => ({
      local: sum.local + (parseAmount(c.localBalance) ?? 0n),
      remote: sum.remote + (parseAmount(c.remoteBalance) ?? 0n),
    }),
    { local: 0n, remote: 0n },
  );
}

const pairLabel = (node: string, peer?: string) => (peer === undefined ? node : `${node}->${peer}`);

export function evaluateBalances(
  checks: BalanceCheck[],
  now: ChannelSnapshot[],
  before: ChannelSnapshot[] | null,
): CheckResult[] {
  const out: CheckResult[] = [];
  for (const check of checks) {
    const label = pairLabel(check.node, check.peer);
    const current = balancesOf(now, check);
    const previous = before === null ? null : balancesOf(before, check);
    const delta = (side: keyof Balances): bigint | null =>
      current === null || previous === null ? null : current[side] - previous[side];

    if (check.local !== undefined) {
      out.push(amountCheck(`${label} local balance`, current?.local ?? null, check.local, check.asset));
    }
    if (check.remote !== undefined) {
      out.push(amountCheck(`${label} remote balance`, current?.remote ?? null, check.remote, check.asset));
    }
    if (check.localDelta !== undefined) {
      out.push(amountCheck(`${label} local balance change`, delta("local"), check.localDelta, check.asset));
    }
    if (check.remoteDelta !== undefined) {
      out.push(amountCheck(`${label} remote balance change`, delta("remote"), check.remoteDelta, check.asset));
    }
  }
  return out;
}

export function evaluateChannels(checks: ChannelCheck[], now: ChannelSnapshot[]): CheckResult[] {
  return checks.map((check) => {
    const states = now.filter((s) => s.node === check.node && s.peer === check.peer).map((s) => s.state);
    return {
      check: `${check.node}->${check.peer} channel state`,
      expected: check.state,
      actual: states.length === 0 ? "no channel" : states.join(", "),
      match: states.includes(check.state),
    };
  });
}

export function evaluateInvoices(
  checks: InvoiceCheck[],
  statuses: Record<string, InvoiceStatus | null>,
): CheckResult[] {
  return checks.map((check) => {
    const actual = statuses[check.node] ?? null;
    return {
      check: `${check.node} invoice status`,
      expected: check.status,
      actual: actual ?? "no invoice",
      match: actual === check.status,
    };
  });
}

export function evaluateOnchain(
  checks: OnchainCheck[],
  now: Record<string, bigint>,
  before: Record<string, bigint> | null,
): CheckResult[] {
  const out: CheckResult[] = [];
  for (const check of checks) {
    const current = now[check.node] ?? null;
    const previous = before?.[check.node] ?? null;
    if (check.capacity !== undefined) {
      out.push(amountCheck(`${check.node} on-chain capacity`, current, check.capacity, "CKB"));
    }
    if (check.capacityDelta !== undefined) {
      const delta = current === null || previous === null ? null : current - previous;
      out.push(amountCheck(`${check.node} on-chain capacity change`, delta, check.capacityDelta, "CKB"));
    }
  }
  return out;
}

export function needsBeforeState(expect: StepExpectation): boolean {
  return (
    (expect.balances ?? []).some((b) => b.localDelta !== undefined || b.remoteDelta !== undefined) ||
    (expect.onchain ?? []).some((c) => c.capacityDelta !== undefined)
  );
}
