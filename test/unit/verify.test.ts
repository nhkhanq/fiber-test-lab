import { describe, expect, it } from "vitest";
import type { StepRecord } from "../../lib/runlog/store";
import {
  evaluateBalances,
  evaluateChannels,
  evaluateInvoices,
  evaluateOnchain,
  evaluatePayment,
  matchesAmount,
  describeMatcher,
  needsBeforeState,
} from "../../lib/scenario/assertions";
import { classifyFailure, mapError } from "../../lib/scenario/errorCategory";
import { parseScenario } from "../../lib/scenario/loader";
import type { ScenarioInput } from "../../lib/scenario/schema";
import { describeMismatch, verifyExpectation } from "../../lib/scenario/verify";

const step = (action: string, input: unknown, result: unknown, extra: Partial<StepRecord> = {}): StepRecord => ({
  action,
  input,
  result,
  at: "2026-11-09T00:00:00.000Z",
  ...extra,
});

const paid = step("send_payment", { from: "alice", to: "bob" }, { status: "Success", fee: "0x0" });
const scenarioOf = (input: Partial<ScenarioInput>) =>
  parseScenario({
    name: "t",
    nodes: ["alice", "bob"],
    channels: [{ from: "alice", to: "bob", capacity: 500 }],
    seed: [{ action: "send_payment", from: "alice", to: "bob", amount: 1 }],
    ...input,
  });

describe("classifying failures", () => {
  it("maps the messages real FNN nodes produce", () => {
    expect(mapError("Failed to build route, Insufficient balance: max outbound liquidity 40100000000 is insufficient, required amount: 45000000000")).toBe("insufficient_outbound");
    expect(mapError("PathFind error: no path found")).toBe("no_route_found");
    expect(mapError('InvalidParameter: Failed to validate payment request: "invoice is expired"')).toBe("invoice_expired");
    expect(mapError("Build payment route error: Failed to build route, PathFind error: no path found")).toBe("no_route_found");
  });

  it("returns null for a message it does not know", () => {
    expect(mapError("something else entirely")).toBeNull();
  });

  it("classifies a payment that failed after being accepted", () => {
    expect(classifyFailure({ failed_error: "PathFind error: no path found" })).toBe("no_route_found");
  });

  it("prefers connectivity, because an offline peer reports the same message as no liquidity", () => {
    expect(classifyFailure({ error: "max outbound liquidity 0 is insufficient", peerConnected: false })).toBe("peer_offline");
    expect(classifyFailure({ error: "max outbound liquidity 0 is insufficient", peerConnected: true })).toBe("insufficient_outbound");
  });
});

describe("amount matching", () => {
  it("compares exactly in base units", () => {
    expect(matchesAmount(10_000_000n, 0.1, "CKB")).toBe(true);
    expect(matchesAmount(10_000_001n, 0.1, "CKB")).toBe(false);
    expect(matchesAmount(100n, 100, "RUSD")).toBe(true);
  });

  it("treats a range as inclusive", () => {
    expect(matchesAmount(100_000_000n, { min: 1 }, "CKB")).toBe(true);
    expect(matchesAmount(100_000_000n, { max: 1 }, "CKB")).toBe(true);
    expect(matchesAmount(100_000_001n, { max: 1 }, "CKB")).toBe(false);
    expect(matchesAmount(99_999_999n, { min: 1 }, "CKB")).toBe(false);
  });

  it("describes what it expected", () => {
    expect(describeMatcher(0.1, "CKB")).toBe("0.1 CKB");
    expect(describeMatcher({ min: 1, max: 2 }, "CKB")).toBe(">= 1 CKB and <= 2 CKB");
  });
});

describe("payment checks", () => {
  it("treats a payment rejected before it got a hash as failed", () => {
    const [check] = evaluatePayment({ status: "failed" }, { error: "boom" }, "CKB");
    expect(check).toMatchObject({ actual: "failed", match: true });
  });

  it("reads the reason of an asynchronous failure", () => {
    const [check] = evaluatePayment({ reason: "no_route_found" }, { status: "Failed", failed_error: "no path found" }, "CKB");
    expect(check).toMatchObject({ actual: "no_route_found", match: true });
  });

  it("checks the fee, and fails when there is none", () => {
    expect(evaluatePayment({ fee: 0.1 }, { status: "Success", fee: "0x989680" }, "CKB")[0]?.match).toBe(true);
    expect(evaluatePayment({ fee: 0 }, { error: "boom" }, "CKB")[0]).toMatchObject({ actual: "none", match: false });
  });
});

describe("state checks", () => {
  const snap = (node: string, peer: string, local: number, remote: number, asset = "CKB", state = "ChannelReady") => ({
    node,
    peer,
    channelId: `${node}-${peer}`,
    state,
    asset,
    localBalance: (BigInt(local) * 100_000_000n).toString(),
    remoteBalance: (BigInt(remote) * 100_000_000n).toString(),
  });

  it("compares a balance towards one peer", () => {
    const now = [snap("alice", "bob", 301, 100)];
    const results = evaluateBalances([{ node: "alice", peer: "bob", asset: "CKB", local: 301, remote: 100 }], now, null);
    expect(results.map((r) => r.match)).toEqual([true, true]);
  });

  it("sums across channels when no peer is named", () => {
    const now = [snap("bob", "alice", 10, 0), snap("bob", "carol", 5, 0)];
    expect(evaluateBalances([{ node: "bob", asset: "CKB", local: 15 }], now, null)[0]?.match).toBe(true);
  });

  it("does not mix assets", () => {
    const now = [snap("alice", "bob", 7, 0, "RUSD")];
    expect(evaluateBalances([{ node: "alice", peer: "bob", asset: "CKB", local: 0 }], now, null)[0]).toMatchObject({
      actual: "none",
      match: false,
    });
  });

  it("computes a delta against the state before the step", () => {
    const before = [snap("alice", "bob", 401, 0)];
    const now = [snap("alice", "bob", 301, 100)];
    const check = { node: "alice", peer: "bob", asset: "CKB" as const, localDelta: -100, remoteDelta: 100 };
    expect(evaluateBalances([check], now, before).map((r) => r.match)).toEqual([true, true]);
  });

  it("fails a delta that has nothing to compare with", () => {
    const now = [snap("alice", "bob", 301, 100)];
    expect(evaluateBalances([{ node: "alice", peer: "bob", asset: "CKB", localDelta: -100 }], now, [])[0]?.match).toBe(false);
  });

  it("finds the expected state among parallel channels", () => {
    const now = [snap("alice", "bob", 1, 0, "CKB", "ShuttingDown"), snap("alice", "bob", 1, 0)];
    expect(evaluateChannels([{ node: "alice", peer: "bob", state: "ChannelReady" }], now)[0]?.match).toBe(true);
    expect(evaluateChannels([{ node: "alice", peer: "carol", state: "ChannelReady" }], now)[0]).toMatchObject({
      actual: "no channel",
      match: false,
    });
  });

  it("reports an invoice that was never created", () => {
    expect(evaluateInvoices([{ node: "bob", status: "Paid" }], { bob: "Paid" })[0]?.match).toBe(true);
    expect(evaluateInvoices([{ node: "bob", status: "Paid" }], { bob: null })[0]).toMatchObject({ actual: "no invoice" });
  });

  it("checks on-chain capacity and its change", () => {
    const results = evaluateOnchain(
      [{ node: "alice", capacity: { min: 9 }, capacityDelta: -1 }],
      { alice: 900_000_000n },
      { alice: 1_000_000_000n },
    );
    expect(results.map((r) => r.match)).toEqual([true, true]);
  });

  it("only captures a before-state when something needs one", () => {
    expect(needsBeforeState({ balances: [{ node: "a", asset: "CKB", local: 1 }] })).toBe(false);
    expect(needsBeforeState({ balances: [{ node: "a", asset: "CKB", localDelta: 1 }] })).toBe(true);
    expect(needsBeforeState({ onchain: [{ node: "a", capacityDelta: 1 }] })).toBe(true);
  });
});

describe("verifyExpectation", () => {
  it("passes when the payments match the scenario", () => {
    expect(verifyExpectation(scenarioOf({ expect: { status: "succeeded" } }), [paid])).toMatchObject({
      match: true,
      expected: "succeeded",
      actual: "succeeded",
    });
  });

  it("fails when any payment failed but all were expected to succeed", () => {
    const failed = step("send_payment", { from: "alice", to: "bob" }, { error: "boom" });
    expect(verifyExpectation(scenarioOf({ expect: { status: "succeeded" } }), [paid, failed])?.match).toBe(false);
  });

  it("verifies the reason of a failure that arrived asynchronously", () => {
    const failed = step("send_payment", { from: "alice", to: "bob" }, { status: "Failed", failed_error: "PathFind error: no path found" });
    const result = verifyExpectation(scenarioOf({ expect: { status: "failed", reason: "no_route_found" } }), [failed]);
    expect(result).toMatchObject({ match: true, reason: { actual: "no_route_found", match: true } });
  });

  it("does not pass a scenario whose run recorded no payment", () => {
    expect(verifyExpectation(scenarioOf({ expect: { status: "succeeded" } }), [])?.match).toBe(false);
  });

  it("fails the scenario when a step check fails, even if the payments match", () => {
    const check = { check: "alice local balance", expected: "1 CKB", actual: "2 CKB", match: false };
    const steps = [step("send_payment", {}, { status: "Success", fee: "0x0" }, { checks: [check] })];
    const result = verifyExpectation(scenarioOf({ expect: { status: "succeeded" } }), steps)!;
    expect(result.match).toBe(false);
    expect(result.failedChecks).toEqual([{ step: 0, action: "send_payment", check }]);
    expect(describeMismatch(result)).toEqual(["steps[0] send_payment: alice local balance expected 1 CKB but got 2 CKB"]);
  });

  it("supports scenarios with expectations only on steps", () => {
    const check = { check: "payment status", expected: "succeeded", actual: "succeeded", match: true };
    const result = verifyExpectation(
      scenarioOf({ seed: [{ action: "send_payment", from: "alice", to: "bob", amount: 1, expect: { status: "succeeded" } }] }),
      [step("send_payment", {}, { status: "Success" }, { checks: [check] })],
    );
    expect(result).toMatchObject({ match: true, expected: null, stepChecks: 1 });
  });

  it("describes a scenario-level mismatch", () => {
    const failed = step("send_payment", { from: "alice", to: "bob" }, { error: "boom" });
    const result = verifyExpectation(scenarioOf({ expect: { status: "succeeded" } }), [failed])!;
    expect(describeMismatch(result)).toEqual(["scenario: expected succeeded but got failed"]);
  });
});
