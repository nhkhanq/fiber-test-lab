import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { GlobalConfigSchema } from "../../lib/config";
import { imageTags } from "../../lib/docker/images";
import { FiberClient } from "../../lib/fiber/client";
import { buildReportModel } from "../../lib/report/model";
import { RunLogSchema, type StepRecord } from "../../lib/runlog/store";
import {
  evaluateBalances,
  evaluateChannels,
  evaluatePayment,
  evaluatePeers,
  evaluateRefusal,
  paymentState,
} from "../../lib/scenario/assertions";
import { classifyFailure } from "../../lib/scenario/errorCategory";
import { parseScenario, ScenarioValidationError } from "../../lib/scenario/loader";
import type { ScenarioInput } from "../../lib/scenario/schema";
import { describeMismatch, verifyExpectation } from "../../lib/scenario/verify";
import { buildComposeProject } from "../../topology/compose.template";

type Seed = NonNullable<ScenarioInput["seed"]>;

const pay = { action: "send_payment", from: "alice", to: "bob", amount: 10 } as const;
const assertReady = { action: "assert", expect: { channels: [{ node: "alice", peer: "bob", state: "ChannelReady" }] } } as const;

const scenarioWith = (seed: unknown[], extra: object = {}) => ({
  name: "t",
  nodes: ["alice", "bob"],
  channels: [{ from: "alice", to: "bob", capacity: 500 }],
  seed: seed as Seed,
  ...extra,
});

function issuesOf(input: unknown): { path: string; message: string }[] {
  try {
    parseScenario(input);
  } catch (error) {
    if (error instanceof ScenarioValidationError) return error.issues;
    throw error;
  }
  return [];
}

const accepted = (seed: unknown[]) => issuesOf(scenarioWith([...seed, assertReady]));
const rejectedAt = (seed: unknown[]) => accepted(seed).map((i) => i.path);

describe("schema for the lifecycle actions", () => {
  it("accepts each new action with its fields", () => {
    expect(
      accepted([
        { action: "new_invoice", to: "bob", amount: 1, hold: true, finalExpiryDeltaSec: 86400 },
        { ...pay, useInvoice: true, waitFor: "inflight", timeoutSec: 5, expect: { status: "inflight" } },
        { action: "settle_invoice", node: "bob", wrongPreimage: true, expect: { error: "hash mismatch" } },
        { action: "cancel_invoice", node: "bob", expect: { error: "already" } },
        { action: "await_payment", from: "alice", timeoutSec: 5, expect: { status: "failed", reason: "invoice_cancelled" } },
        { action: "close_channel", from: "alice", to: "bob", force: true, expect: { error: "no open" } },
        { action: "disconnect_peer", from: "alice", to: "bob", expect: { peers: [{ node: "alice", peer: "bob", connected: false }] } },
        { action: "connect_peer", from: "alice", to: "bob" },
        { action: "pause_node", node: "bob" },
        { action: "resume_node", node: "bob" },
      ]),
    ).toEqual([]);
  });

  it("names the field each action is missing", () => {
    expect(rejectedAt([{ action: "await_payment" }])).toContain("seed.0.from");
    expect(rejectedAt([{ action: "settle_invoice" }])).toContain("seed.0.node");
    expect(rejectedAt([{ action: "cancel_invoice" }])).toContain("seed.0.node");
    expect(rejectedAt([{ action: "pause_node" }])).toContain("seed.0.node");
    expect(rejectedAt([{ action: "resume_node" }])).toContain("seed.0.node");
    for (const action of ["close_channel", "disconnect_peer", "connect_peer"]) {
      const paths = rejectedAt([{ action }]);
      expect(paths, action).toContain("seed.0.from");
      expect(paths, action).toContain("seed.0.to");
    }
  });

  it("rejects a field on an action it does not apply to", () => {
    expect(rejectedAt([{ ...pay, hold: true }])).toContain("seed.0.hold");
    expect(rejectedAt([{ ...pay, finalExpiryDeltaSec: 60 }])).toContain("seed.0.finalExpiryDeltaSec");
    expect(rejectedAt([{ action: "await_payment", from: "alice", waitFor: "inflight" }])).toContain("seed.0.waitFor");
    expect(rejectedAt([{ action: "mine", timeoutSec: 5 }])).toContain("seed.0.timeoutSec");
    expect(rejectedAt([{ action: "cancel_invoice", node: "bob", wrongPreimage: true }])).toContain("seed.0.wrongPreimage");
    expect(rejectedAt([{ ...pay, force: true }])).toContain("seed.0.force");
  });

  it("keeps payment checks on the steps that have a payment", () => {
    expect(rejectedAt([{ action: "settle_invoice", node: "bob", expect: { status: "succeeded" } }])).toContain("seed.0.expect.status");
    expect(accepted([{ action: "await_payment", from: "alice", expect: { status: "succeeded", fee: 0 } }])).toEqual([]);
  });

  it("only lets a step that can be refused expect a refusal", () => {
    expect(rejectedAt([{ ...pay, expect: { error: "nope" } }])).toContain("seed.0.expect.error");
    expect(rejectedAt([{ action: "mine", expect: { error: "nope" } }])).toContain("seed.0.expect.error");
  });

  it("ties the inflight and timeout outcomes to how the step waits", () => {
    expect(rejectedAt([{ ...pay, expect: { status: "inflight" } }])).toContain("seed.0.expect.status");
    expect(rejectedAt([{ action: "await_payment", from: "alice", expect: { status: "inflight" } }])).toContain("seed.0.expect.status");
    expect(rejectedAt([{ ...pay, waitFor: "inflight", expect: { status: "timeout" } }])).toContain("seed.0.expect.status");
    expect(accepted([{ ...pay, timeoutSec: 1, expect: { status: "timeout" } }])).toEqual([]);
    expect(accepted([{ action: "await_payment", from: "alice", expect: { status: "timeout" } }])).toEqual([]);
  });

  it("keeps a failure reason tied to a failed status", () => {
    expect(rejectedAt([{ ...pay, expect: { status: "timeout", reason: "peer_offline" } }])).toContain("seed.0.expect.reason");
  });

  it("refuses a top-level expect when a payment is left in flight", () => {
    const issues = issuesOf(scenarioWith([{ ...pay, waitFor: "inflight" }], { expect: { status: "succeeded" } }));
    expect(issues.some((i) => i.path === "expect" && /in flight/.test(i.message))).toBe(true);
  });

  it("checks the nodes named in a peer check", () => {
    const messages = accepted([{ action: "assert", expect: { peers: [{ node: "alice", peer: "eve", connected: true }] } }]).map((i) => i.message);
    expect(messages.join(" ")).toContain('"eve"');
  });

  it("requires a value in a balance check, and counts the TLC sides as one", () => {
    expect(rejectedAt([{ action: "assert", expect: { balances: [{ node: "alice", offered: 1 }] } }])).toEqual([]);
    expect(rejectedAt([{ action: "assert", expect: { balances: [{ node: "alice" }] } }])).not.toEqual([]);
  });
});

describe("payment outcomes", () => {
  it("tells four outcomes apart", () => {
    expect(paymentState({ status: "Success" })).toBe("succeeded");
    expect(paymentState({ status: "Failed", failed_error: "x" })).toBe("failed");
    expect(paymentState({ error: "rejected" })).toBe("failed");
    expect(paymentState(null)).toBe("failed");
    expect(paymentState({ status: "Inflight" })).toBe("inflight");
    expect(paymentState({ status: "Created" })).toBe("inflight");
    expect(paymentState({ status: "Inflight", timedOut: true })).toBe("timeout");
    expect(paymentState({ payment_hash: "0x", timedOut: true })).toBe("timeout");
  });

  it("never reports a timeout as a failure", () => {
    const [status] = evaluatePayment({ status: "failed" }, { status: "Inflight", timedOut: true }, "CKB");
    expect(status).toMatchObject({ actual: "timeout", match: false });
  });

  it("fails a scenario whose payment timed out, and says so", () => {
    const step: StepRecord = {
      action: "send_payment",
      input: { from: "alice", to: "bob" },
      result: { status: "Inflight", timedOut: true },
      at: "2026-11-09T00:00:00.000Z",
    };
    const result = verifyExpectation(parseScenario(scenarioWith([pay], { expect: { status: "succeeded" } })), [step])!;
    expect(result).toMatchObject({ match: false, actual: "timeout" });
    expect(describeMismatch(result)).toEqual(["scenario: expected succeeded but got timeout"]);
  });

  it("classifies a cancelled hold invoice", () => {
    expect(classifyFailure({ status: "Failed", failed_error: "InvoiceCancelled" } as never)).toBe("invoice_cancelled");
  });
});

describe("refusals", () => {
  it("matches the expected refusal regardless of case", () => {
    expect(evaluateRefusal("settle_invoice", "hash mismatch", "RPC settle_invoice failed: Hash mismatch")[0]?.match).toBe(true);
  });

  it("fails when a refusal was expected and the node accepted", () => {
    expect(evaluateRefusal("settle_invoice", "hash mismatch", null)[0]).toMatchObject({ actual: "no error", match: false });
  });

  it("fails on a refusal nobody expected", () => {
    expect(evaluateRefusal("close_channel", undefined, "boom")).toEqual([
      { check: "close_channel", expected: "no error", actual: "boom", match: false },
    ]);
  });

  it("has nothing to report when the step simply worked", () => {
    expect(evaluateRefusal("close_channel", undefined, null)).toEqual([]);
  });
});

describe("state checks for the lifecycle", () => {
  const snap = (over: object) => ({
    node: "alice",
    peer: "bob",
    channelId: "c",
    state: "ChannelReady",
    asset: "CKB",
    localBalance: "90100000000",
    remoteBalance: "0",
    offeredBalance: "1001000000",
    receivedBalance: "0",
    ...over,
  });

  it("reads the amount locked in TLCs, which local does not show", () => {
    const check = { node: "alice", peer: "bob", asset: "CKB" as const, local: 901, offered: 10.01, received: 0 };
    expect(evaluateBalances([check], [snap({})], null).map((r) => r.match)).toEqual([true, true, true]);
  });

  it("treats a run-log without TLC fields as zero locked", () => {
    const old = { node: "alice", peer: "bob", channelId: "c", state: "ChannelReady", asset: "CKB", localBalance: "0", remoteBalance: "0" };
    expect(evaluateBalances([{ node: "alice", asset: "CKB", offered: 0 }], [old], null)[0]?.match).toBe(true);
  });

  it("leaves closed channels out of a balance", () => {
    const closed = snap({ channelId: "old", state: "Closed", localBalance: "500" });
    expect(evaluateBalances([{ node: "alice", asset: "CKB", local: 901 }], [closed, snap({})], null)[0]?.match).toBe(true);
    expect(evaluateBalances([{ node: "alice", asset: "CKB", local: 0 }], [closed], null)[0]).toMatchObject({ actual: "none", match: false });
  });

  it("checks how a channel closed", () => {
    const now = [snap({ state: "Closed", stateFlags: "UNCOOPERATIVE_LOCAL|WAITING_ONCHAIN_SETTLEMENT" })];
    expect(evaluateChannels([{ node: "alice", peer: "bob", state: "Closed", flags: "UNCOOPERATIVE_LOCAL" }], now)[0]?.match).toBe(true);
    expect(evaluateChannels([{ node: "alice", peer: "bob", state: "Closed", flags: "COOPERATIVE" }], [snap({ state: "Closed", stateFlags: "COOPERATIVE" })])[0]?.match).toBe(true);
    const wrong = evaluateChannels([{ node: "alice", peer: "bob", state: "Closed", flags: "COOPERATIVE" }], now)[0];
    expect(wrong).toMatchObject({ expected: "Closed (COOPERATIVE)", actual: "Closed (UNCOOPERATIVE_LOCAL|WAITING_ONCHAIN_SETTLEMENT)" });
  });

  it("reports a peer it could not ask as unknown, not as disconnected", () => {
    const checks = [
      { node: "alice", peer: "bob", connected: true },
      { node: "alice", peer: "carol", connected: false },
      { node: "bob", peer: "alice", connected: false },
    ];
    expect(evaluatePeers(checks, { "alice->bob": true, "alice->carol": false, "bob->alice": null })).toEqual([
      { check: "alice->bob connected", expected: "true", actual: "true", match: true },
      { check: "alice->carol connected", expected: "false", actual: "false", match: true },
      { check: "bob->alice connected", expected: "false", actual: "unknown", match: false },
    ]);
  });
});

describe("restarted nodes", () => {
  const servers: Server[] = [];
  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
  });

  async function serve(label: string): Promise<string> {
    const server = createServer((req, res) => {
      req.resume();
      req.on("end", () => res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: label })));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it("follows a node to its new port, on every client sharing the endpoints", async () => {
    const endpoints = { bob: await serve("old-port") };
    const first = new FiberClient({ endpoints });
    const second = new FiberClient({ endpoints });
    expect(await first.rawCall("bob", "node_info")).toBe("old-port");

    first.setEndpoint("bob", await serve("new-port"));

    expect(await first.rawCall("bob", "node_info")).toBe("new-port");
    expect(await second.rawCall("bob", "node_info")).toBe("new-port");
  });
});

describe("compose", () => {
  it("makes the watchtower check often enough for a force-close to settle in a test", () => {
    const config = GlobalConfigSchema.parse({ fnnVersion: "0.9.1" });
    const scenario = parseScenario(scenarioWith([pay], { expect: { status: "succeeded" } }));
    const project = buildComposeProject(scenario, "r", config, imageTags("0.9.1", "abc"));
    expect(project.services.alice?.environment?.FIBER_WATCHTOWER_CHECK_INTERVAL_SECONDS).toBe("2");
  });
});

describe("the viewer", () => {
  it("does not flag a settle or a close that worked", () => {
    const model = buildReportModel(
      RunLogSchema.parse({
        runId: "r",
        scenario: "s",
        status: "completed",
        startedAt: "2026-11-09T00:00:00.000Z",
        network: "n",
        steps: [
          { action: "settle_invoice", input: { node: "bob" }, result: { ok: true }, at: "2026-11-09T00:00:00.000Z" },
          { action: "close_channel", input: { from: "a", to: "b" }, result: { channelId: "c", flags: "COOPERATIVE" }, at: "2026-11-09T00:00:00.000Z" },
          { action: "settle_invoice", input: { node: "bob" }, result: { error: "Hash mismatch" }, at: "2026-11-09T00:00:00.000Z" },
        ],
      }),
    );
    expect(model.steps.map((s) => s.ok)).toEqual([true, true, false]);
  });

  const at = "2026-11-09T00:00:00.000Z";
  const summaries = (steps: Partial<StepRecord>[]) =>
    buildReportModel(
      RunLogSchema.parse({
        runId: "r",
        scenario: "s",
        status: "completed",
        startedAt: at,
        network: "n",
        steps: steps.map((step) => ({ action: "x", at, ...step })),
      }),
    ).steps.map((s) => s.summary);

  it("describes the lifecycle steps", () => {
    expect(
      summaries([
        { action: "new_invoice", input: { to: "bob", amount: 10, asset: "CKB", hold: true } },
        { action: "send_payment", input: { from: "a", to: "b", amount: 1 }, result: { status: "Inflight", timedOut: true } },
        { action: "await_payment", input: { from: "a" }, result: { status: "Success" } },
        { action: "await_payment", input: { from: "a" }, result: { status: "Inflight", timedOut: true } },
        { action: "settle_invoice", input: { node: "bob" } },
        { action: "cancel_invoice", input: { node: "bob" } },
        { action: "close_channel", input: { from: "a", to: "b", force: true } },
        { action: "disconnect_peer", input: { from: "a", to: "b" } },
        { action: "connect_peer", input: { from: "a", to: "b" } },
        { action: "pause_node", input: { node: "bob" } },
        { action: "resume_node", input: { node: "bob" } },
      ]),
    ).toEqual([
      "bob invoices 10 CKB, held",
      "a → b, 1 CKB — timed out",
      "a — Success",
      "a — timed out",
      "bob",
      "bob",
      "a → b, forced",
      "a → b",
      "a → b",
      "bob",
      "bob",
    ]);
  });
});
