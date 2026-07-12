import { describe, expect, it } from "vitest";
import { loadConfig } from "../lib/config";
import { reset } from "../lib/docker/orchestrator";
import { runScenario } from "../lib/scenario/run";

const SCENARIO = "multi-asset";
const TIMEOUT_MS = 300_000;

describe("multi-asset", () => {
  it(
    "Alice pays Bob in RUSD (sUDT) over a UDT channel — succeeds",
    async () => {
      const config = loadConfig();
      const { up, store, expectation } = await runScenario(SCENARIO, config);
      try {
        expect(expectation?.match, "expectation should match").toBe(true);

        const mint = store.data.steps.find((s) => s.action === "mint_udt");
        expect(mint, "should have a mint_udt step").toBeTruthy();

        const send = store.data.steps.find((s) => s.action === "send_payment");
        expect((send?.result as { status?: string })?.status, "payment RUSD Success").toBe("Success");
        expect((send?.input as { asset?: string })?.asset).toBe("RUSD");
      } finally {
        await reset(up.runId, config);
      }
    },
    TIMEOUT_MS,
  );
});
