import { loadConfig } from "../lib/config";
import { reset as resetRun } from "../lib/docker/orchestrator";
import { FiberClient } from "../lib/fiber/client";
import type { RunLogStore, StepRecord } from "../lib/runlog/store";
import { runScenario } from "../lib/scenario/run";
import type { Scenario } from "../lib/scenario/schema";
import type { ExpectationResult } from "../lib/scenario/verify";

export interface ScenarioContext {
  runId: string;
  network: string;
  scenario: Scenario;
  expectation: ExpectationResult | null;
  store: RunLogStore;
  /** payment_hash của send_payment cuối, hoặc null nếu payment lỗi đồng bộ (không sinh hash). */
  lastPaymentId: string | null;
  /** Node đã gửi payment cuối — để poll get_payment đúng chỗ. */
  lastPaymentFrom: string | null;
  call(node: string, method: string, params?: unknown[]): Promise<unknown>;
  reset(): Promise<void>;
}

function lastSendPayment(store: RunLogStore): StepRecord | undefined {
  return [...store.data.steps].reverse().find((s) => s.action === "send_payment");
}

/**
 * up + seed 1 scenario rồi trả về context để test-kit assert (không teardown — gọi `ctx.reset()` khi xong).
 * Dùng chung `runScenario` với `fiber-lab up`, nên mọi RPC vẫn ghi vào run-log.
 */
export async function setupScenario(
  name: string,
  options: { keep?: boolean } = {},
): Promise<ScenarioContext> {
  const config = loadConfig();
  const { scenario, up, store, expectation } = await runScenario(name, config, options);
  const client = new FiberClient({ endpoints: up.endpoints, logger: store.recordRpc });

  const last = lastSendPayment(store);
  const lastPaymentId = (last?.result as { payment_hash?: string } | null)?.payment_hash ?? null;
  const lastPaymentFrom = (last?.input as { from?: string } | null)?.from ?? null;

  return {
    runId: up.runId,
    network: up.network,
    scenario,
    expectation,
    store,
    lastPaymentId,
    lastPaymentFrom,
    call: (node, method, params = []) => client.rawCall(node, method, params),
    reset: () => resetRun(up.runId, config),
  };
}
