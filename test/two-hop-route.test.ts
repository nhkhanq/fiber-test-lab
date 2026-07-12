import { describe, expect, it } from "vitest";
import { loadConfig } from "../lib/config";
import { reset } from "../lib/docker/orchestrator";
import { runScenario } from "../lib/scenario/run";

const SCENARIO = "two-hop-route";
const TIMEOUT_MS = 300_000;

describe("two-hop-route", () => {
  it(
    "Alice trả Charlie qua Bob thành công, routeHops = 1",
    async () => {
      const config = loadConfig();
      const { up, store, expectation } = await runScenario(SCENARIO, config);
      try {
        expect(expectation?.match, "expect phải khớp (status + routeHops)").toBe(true);
        expect(expectation?.routeHops).toEqual({ expected: 1, actual: 1, match: true });

        const send = store.data.steps.find((s) => s.action === "send_payment");
        const result = send?.result as { status?: string; fee?: string } | undefined;
        expect(result?.status, "payment Success").toBe("Success");
        // Qua 1 hop trung gian (Bob) ⇒ phí định tuyến > 0, khác kênh trực tiếp (fee 0).
        expect(Number(result?.fee ?? "0"), "fee > 0 khi qua hop trung gian").toBeGreaterThan(0);
      } finally {
        await reset(up.runId, config);
      }
    },
    TIMEOUT_MS,
  );
});
