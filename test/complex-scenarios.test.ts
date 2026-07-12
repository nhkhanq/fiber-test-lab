import { describe, expect, it } from "vitest";
import { loadConfig } from "../lib/config";
import { reset } from "../lib/docker/orchestrator";
import { runScenario } from "../lib/scenario/run";

const TIMEOUT_MS = 300_000;

function countSuccessfulPayments(steps: { action: string; result: unknown }[]): number {
  return steps.filter((s) => s.action === "send_payment" && (s.result as { status?: string })?.status === "Success").length;
}

describe("complex scenarios", () => {
  it(
    "round-trip: bidirectional payments A->B then B->A both succeed",
    async () => {
      const config = loadConfig();
      const { up, store, expectation } = await runScenario("round-trip", config);
      try {
        expect(expectation?.match).toBe(true);
        expect(countSuccessfulPayments(store.data.steps)).toBe(2);
      } finally {
        await reset(up.runId, config);
      }
    },
    TIMEOUT_MS,
  );

  it(
    "channel-drain: 4 payments succeed, then outbound is depleted -> insufficient_outbound",
    async () => {
      const config = loadConfig();
      const { up, store, expectation } = await runScenario("channel-drain", config);
      try {
        expect(expectation?.match).toBe(true);
        expect(expectation?.reason?.actual).toBe("insufficient_outbound");
        expect(countSuccessfulPayments(store.data.steps)).toBe(4);
      } finally {
        await reset(up.runId, config);
      }
    },
    TIMEOUT_MS,
  );

  it(
    "two-hop-bottleneck: the Bob->Charlie hop lacks liquidity -> no_route_found",
    async () => {
      const config = loadConfig();
      const { up, expectation } = await runScenario("two-hop-bottleneck", config);
      try {
        expect(expectation?.match).toBe(true);
        expect(expectation?.reason?.actual).toBe("no_route_found");
      } finally {
        await reset(up.runId, config);
      }
    },
    TIMEOUT_MS,
  );
});
