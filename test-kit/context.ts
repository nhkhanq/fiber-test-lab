import { loadConfig } from "../lib/config";
import { reset as resetRun } from "../lib/docker/orchestrator";
import { FiberClient } from "../lib/fiber/client";
import { subscribePayments, type PaymentWatcher } from "../lib/fiber/subscribe";
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
  /** Host RPC endpoint per node (also the WS endpoint — FNN shares the port) for event-driven waits. */
  endpoints: Record<string, string>;
  /** payment_hash of the last send_payment, or null if the payment failed synchronously (no hash). */
  lastPaymentId: string | null;
  /** The node that sent the last payment — so get_payment is polled on the right node. */
  lastPaymentFrom: string | null;
  call(node: string, method: string, params?: unknown[]): Promise<unknown>;
  /** Open an event-driven watcher (subscribe_store_changes) on a node — wait on events instead of polling. */
  watchPayments(node: string): Promise<PaymentWatcher>;
  reset(): Promise<void>;
}

function lastSendPayment(store: RunLogStore): StepRecord | undefined {
  return [...store.data.steps].reverse().find((s) => s.action === "send_payment");
}

/**
 * up + seed a scenario and return a context for the test-kit to assert on (no teardown — call `ctx.reset()` when done).
 * Shares `runScenario` with `fiber-lab up`, so every RPC is still logged to the run-log.
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
    endpoints: up.endpoints,
    lastPaymentId,
    lastPaymentFrom,
    call: (node, method, params = []) => client.rawCall(node, method, params),
    watchPayments: (node) => subscribePayments(up.endpoints[node]!, config),
    reset: () => resetRun(up.runId, config),
  };
}
