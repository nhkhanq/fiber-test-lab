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
      "1 containers started",
    ]);
  });

  it("summarises a scenario that only has step expectations", () => {
    const model = modelOf([{ action: "expect", result: { match: true, expected: null, actual: null, stepChecks: 3, failedChecks: [] } }]);
    expect(model.steps[0]?.summary).toBe("3/3 step checks");
    expect(model.summary.verdict).toBe("match");
  });

  it("still reads a run-log from before step checks existed", () => {
    const [step] = modelOf([{ action: "docker_up", input: { services: ["ckb"] }, result: { imagesBuilt: 2, containersStarted: 1 } }]).steps;
    expect(step?.summary).toBe("2 images built, 1 containers started");
  });
});
