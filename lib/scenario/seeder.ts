import type { RunLog } from "../runlog/store";
import type { GlobalConfig } from "../config";
import { CkbChain } from "../ckb/chain";
import { CKB_SERVICE, EXIT_CODES } from "../constants";
import { CliError } from "../errors";
import { FiberClient } from "../fiber/client";
import type { RunLogStore } from "../runlog/store";
import { ScenarioRuntime } from "./runtime";
import type { Scenario } from "./schema";

function endpointsOf(log: RunLog): Record<string, string> {
  const endpoints: Record<string, string> = {};
  for (const n of log.nodes) if (n.endpoint && n.name !== CKB_SERVICE) endpoints[n.name] = n.endpoint;
  return endpoints;
}

export async function reseed(scenario: Scenario, store: RunLogStore, config: GlobalConfig): Promise<void> {
  const log = store.data;
  const ckbEndpoint = log.nodes.find((n) => n.name === CKB_SERVICE)?.endpoint;
  if (!ckbEndpoint) {
    throw new CliError(
      `Run ${log.runId} has no CKB endpoint in its run-log — it predates chain control. Start a new run with \`fiber-lab up\`.`,
      EXIT_CODES.validation,
    );
  }

  const chain = new CkbChain({ endpoint: ckbEndpoint, blockIntervalMs: config.blockIntervalMs, logger: store.recordRpc });
  const client = new FiberClient({ endpoints: endpointsOf(log), logger: store.recordRpc });
  const runtime = new ScenarioRuntime({
    scenario,
    client,
    chain,
    genesis: await chain.genesis(),
    store,
    config,
    runId: log.runId,
  });
  await runtime.init();
  await runtime.repeatSeedSteps();
}
