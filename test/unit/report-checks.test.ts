import { describe, expect, it } from "vitest";
import { buildReportModel } from "../../lib/report/model";
import { RunLogSchema, type StepRecord } from "../../lib/runlog/store";

const at = "2026-11-09T00:00:00.000Z";

function modelOf(steps: Partial<StepRecord>[]) {
  return buildReportModel(
    RunLogSchema.parse({
      runId: "r",
      scenario: "s",
      status: "completed",
      startedAt: at,
      network: "n",
      steps: steps.map((step) => ({ action: "x", at, ...step })),
    }),
  );
}

describe("the viewer and step checks", () => {
  const failed = { check: "payment fee", expected: "5 CKB", actual: "0 CKB", match: false };
  const passed = { check: "payment status", expected: "succeeded", actual: "succeeded", match: true };

  it("flags a step whose check failed and says which one", () => {
    const [step] = modelOf([{ action: "mine", input: { blocks: 1 }, result: { tip: "9" }, checks: [passed, failed] }]).steps;
    expect(step?.ok).toBe(false);
    expect(step?.summary).toBe("1 block(s), tip 9 — payment fee: expected 5 CKB, got 0 CKB");
  });

  it("leaves a step alone when its checks pass", () => {
    const [step] = modelOf([{ action: "mine", input: { blocks: 1 }, result: { tip: "9" }, checks: [passed] }]).steps;
    expect(step?.ok).toBe(true);
    expect(step?.summary).toBe("1 block(s), tip 9");
  });

  it("describes the steps the chain and image work added", () => {
    const steps = modelOf([
      { action: "build_images", result: { built: ["a", "b"], pulled: [] } },
      { action: "chain_ready", input: { mining: "manual" } },
      { action: "advance_epochs", input: { epochs: 2 }, result: { tip: "30" } },
      { action: "assert", checks: [passed, failed] },
      { action: "docker_up", input: { services: ["ckb"] }, result: { containersStarted: 1 } },
    ]).steps;
    expect(steps.map((s) => s.summary)).toEqual([
      "2 built, 0 pulled",
      "manual mining",
      "2 epoch(s), tip 30",
      "1/2 checks passed — payment fee: expected 5 CKB, got 0 CKB",
      "1 container started",
    ]);
  });

  it("summarises a scenario that only has step expectations", () => {
    const model = modelOf([{ action: "expect", result: { match: true, expected: null, actual: null, stepChecks: 3, failedChecks: [] } }]);
    expect(model.steps[0]?.summary).toBe("3/3 step checks");
    expect(model.summary.verdict).toBe("match");
    expect(model.summary.expected).toBe("3 step checks");
  });

  it("counts what passed when a step expectation does not hold", () => {
    const { summary } = modelOf([
      { action: "expect", result: { match: false, expected: null, actual: null, stepChecks: 3, failedChecks: [{ step: 1 }] } },
    ]);
    expect(summary.verdict).toBe("mismatch");
    expect(summary.actual).toBe("2 passed");
  });

  it("still reads a run-log from before step checks existed", () => {
    const [step] = modelOf([{ action: "docker_up", input: { services: ["ckb"] }, result: { imagesBuilt: 2, containersStarted: 1 } }]).steps;
    expect(step?.summary).toBe("2 images built, 1 container started");
  });

  it("shows a channel as closed as soon as one side has closed it", () => {
    const side = (node: string, peer: string, state: string) => ({ node, peer, channelId: "0x1", state, asset: "CKB", localBalance: "1", remoteBalance: "2" });
    const { edges } = modelOf([{ action: "close_channel", channels: [side("alice", "bob", "Closed"), side("bob", "alice", "ChannelReady")] }]);
    expect(edges[0]?.state).toBe("Closed");
  });

  const refused = { error: "RPC settle_invoice failed: Invoice is still open" };

  it("does not flag a refusal the scenario asked for, and says what the node refused", () => {
    const check = { check: "settle_invoice error", expected: "still open", actual: refused.error, match: true };
    const [step] = modelOf([{ action: "settle_invoice", input: { node: "organizer" }, result: refused, checks: [check] }]).steps;
    expect(step?.ok).toBe(true);
    expect(step?.summary).toBe("organizer — refused: Invoice is still open");
  });

  it("flags a refusal nothing asked for", () => {
    const [step] = modelOf([{ action: "settle_invoice", input: { node: "organizer" }, result: refused }]).steps;
    expect(step?.ok).toBe(false);
  });

  it("does not flag a payment expected to fail", () => {
    const check = { check: "payment status", expected: "failed", actual: "failed", match: true };
    const [step] = modelOf([{ action: "send_payment", input: { from: "a", to: "b", amount: 1 }, result: { error: "no path" }, checks: [check] }]).steps;
    expect(step?.ok).toBe(true);
  });

  it("flags a payment that failed when the check on it was about something else", () => {
    const [step] = modelOf([{ action: "send_payment", input: { from: "a", to: "b", amount: 1 }, result: { error: "no path" }, checks: [passed] }]).steps;
    expect(step?.ok).toBe(false);
  });
});
