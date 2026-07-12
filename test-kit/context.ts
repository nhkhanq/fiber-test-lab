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
  endpoints: Record<string, string>;
  lastPaymentId: string | null;
  lastPaymentFrom: string | null;
  call(node: string, method: string, params?: unknown[]): Promise<unknown>;
  watchPayments(node: string): Promise<PaymentWatcher>;
  reset(): Promise<void>;
}

function lastSendPayment(store: RunLogStore): StepRecord | undefined {
  return [...store.data.steps].reverse().find((s) => s.action === "send_payment");
}

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
