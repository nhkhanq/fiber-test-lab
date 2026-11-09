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
  PaymentState,
  PeerCheck,
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
  payment_hash?: string;
  status?: string;
  fee?: unknown;
  error?: unknown;
  failed_error?: unknown;
  peerConnected?: boolean;
  timedOut?: boolean;
}

/** Four outcomes, because a payment we stopped waiting for has not failed: it may still settle.
 *  A payment rejected before it got a hash has no status, and has failed. */
export function paymentState(result: PaymentResult | null): PaymentState {
  if (result?.status === "Success") return "succeeded";
  if (result?.timedOut === true) return "timeout";
  if (result?.status === "Inflight" || result?.status === "Created") return "inflight";
  return "failed";
}

/** A refusable step is expected to work unless the scenario says it should be refused. */
export function evaluateRefusal(action: string, expected: string | undefined, actual: string | null): CheckResult[] {
  if (expected !== undefined) {
    return [
      {
        check: `${action} error`,
        expected,
        actual: actual ?? "no error",
        match: actual !== null && actual.toLowerCase().includes(expected.toLowerCase()),
      },
    ];
  }
  return actual === null ? [] : [{ check: action, expected: "no error", actual, match: false }];
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
  offered: bigint;
  received: bigint;
}

function balancesOf(snapshots: ChannelSnapshot[], check: BalanceCheck): Balances | null {
  const channels = snapshots.filter(
    (s) =>
      s.node === check.node &&
      s.asset === check.asset &&
      s.state !== "Closed" &&
      (check.peer === undefined || s.peer === check.peer),
  );
  if (channels.length === 0) return null;
  return channels.reduce<Balances>(
    (sum, c) => ({
      local: sum.local + (parseAmount(c.localBalance) ?? 0n),
      remote: sum.remote + (parseAmount(c.remoteBalance) ?? 0n),
      offered: sum.offered + (parseAmount(c.offeredBalance) ?? 0n),
      received: sum.received + (parseAmount(c.receivedBalance) ?? 0n),
    }),
    { local: 0n, remote: 0n, offered: 0n, received: 0n },
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
    if (check.offered !== undefined) {
      out.push(amountCheck(`${label} offered in TLCs`, current?.offered ?? null, check.offered, check.asset));
    }
    if (check.received !== undefined) {
      out.push(amountCheck(`${label} received in TLCs`, current?.received ?? null, check.received, check.asset));
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
    const channels = now.filter((s) => s.node === check.node && s.peer === check.peer);
    const expected = check.flags === undefined ? check.state : `${check.state} (${check.flags})`;
    return {
      check: `${check.node}->${check.peer} channel state`,
      expected,
      actual:
        channels.length === 0
          ? "no channel"
          : channels.map((c) => (c.stateFlags ? `${c.state} (${c.stateFlags})` : c.state)).join(", "),
      match: channels.some(
        (c) => c.state === check.state && (check.flags === undefined || (c.stateFlags ?? "").includes(check.flags)),
      ),
    };
  });
}

export function evaluatePeers(checks: PeerCheck[], connected: Record<string, boolean | null>): CheckResult[] {
  return checks.map((check) => {
    const actual = connected[`${check.node}->${check.peer}`] ?? null;
    return {
      check: `${check.node}->${check.peer} connected`,
      expected: String(check.connected),
      actual: actual === null ? "unknown" : String(actual),
      match: actual === check.connected,
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
