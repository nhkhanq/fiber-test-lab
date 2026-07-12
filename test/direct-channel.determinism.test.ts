import { describe, expect, it } from "vitest";
import { loadConfig } from "../lib/config";
import { reset } from "../lib/docker/orchestrator";
import type { RunLogStore } from "../lib/runlog/store";
import { runScenario } from "../lib/scenario/run";

const SCENARIO = "direct-channel";
const RUNS = 3;
const PER_RUN_TIMEOUT_MS = 240_000;

function outcome(store: RunLogStore): unknown {
  return store.data.steps.map((s) => {
    if (s.action === "send_payment") {
      const r = s.result as { status?: string; fee?: string; failed_error?: unknown };
      return { action: s.action, status: r.status, fee: r.fee, failed_error: r.failed_error };
    }
    return { action: s.action, result: s.result };
  });
}

describe("direct-channel determinism", () => {
  it(
    `produces the same result across ${RUNS} runs`,
    async () => {
      const config = loadConfig();
      const outcomes: unknown[] = [];

      for (let i = 0; i < RUNS; i++) {
        const { up, store, expectation } = await runScenario(SCENARIO, config);
        try {
          expect(expectation?.match, `run ${i}: expectation should match`).toBe(true);
          const send = store.data.steps.find((s) => s.action === "send_payment");
          expect((send?.result as { status?: string })?.status, `run ${i}: payment Success`).toBe("Success");
          outcomes.push(outcome(store));
        } finally {
          await reset(up.runId, config);
        }
      }

      for (let i = 1; i < RUNS; i++) {
        expect(outcomes[i], `run ${i} should equal run 0`).toEqual(outcomes[0]);
      }
    },
    PER_RUN_TIMEOUT_MS * RUNS,
  );
});
