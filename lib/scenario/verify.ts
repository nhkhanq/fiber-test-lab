import type { StepRecord } from "../runlog/store";
import type { Scenario } from "./schema";

export interface ExpectationResult {
  match: boolean;
  expected: "succeeded" | "failed";
  actual: "succeeded" | "failed";
}

/**
 * So khớp `expect.status` với kết quả các bước send_payment đã ghi (coarse: chỉ succeeded/failed).
 * `reason`/`routeHops` để dành E5-4. Không có send_payment → null (không có gì để kiểm).
 */
export function verifyExpectation(scenario: Scenario, steps: StepRecord[]): ExpectationResult | null {
  const payments = steps.filter((s) => s.action === "send_payment");
  if (payments.length === 0) return null;

  const allSucceeded = payments.every((p) => (p.result as { status?: string } | null)?.status === "Success");
  const actual = allSucceeded ? "succeeded" : "failed";
  return { match: actual === scenario.expect.status, expected: scenario.expect.status, actual };
}
