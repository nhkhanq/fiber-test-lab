import { describe, expect, it } from "vitest";
import { loadConfig } from "../lib/config";
import { reset } from "../lib/docker/orchestrator";
import { runScenario } from "../lib/scenario/run";

const SCENARIO = "insufficient-capacity";
const TIMEOUT_MS = 300_000;

describe("insufficient-capacity", () => {
  it(
    "payment vượt outbound → fail với reason insufficient_outbound",
    async () => {
      const config = loadConfig();
      const { up, store, expectation } = await runScenario(SCENARIO, config);
      try {
        expect(expectation?.match, "expect phải khớp (status failed + reason)").toBe(true);
        expect(expectation?.actual).toBe("failed");
        expect(expectation?.reason).toEqual({
          expected: "insufficient_outbound",
          actual: "insufficient_outbound",
          match: true,
        });

        const send = store.data.steps.find((s) => s.action === "send_payment");
        expect((send?.result as { error?: string })?.error, "lỗi thô có nhắc outbound liquidity").toMatch(
          /outbound liquidity|Insufficient balance/i,
        );
      } finally {
        await reset(up.runId, config);
      }
    },
    TIMEOUT_MS,
  );
});
