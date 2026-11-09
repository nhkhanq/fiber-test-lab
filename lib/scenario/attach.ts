import { CkbChain } from "../ckb/chain";
import type { GlobalConfig } from "../config";
import { CKB_SERVICE, EXIT_CODES } from "../constants";
import { CliError } from "../errors";
import { FiberClient } from "../fiber/client";
import { latestLiveRun, RunLogStore, type RunLog, type StepRecord } from "../runlog/store";
import { parseScenario } from "./loader";
import { ScenarioRuntime } from "./runtime";
import type { Channel, Scenario } from "./schema";

function endpointsOf(log: RunLog): Record<string, string> {
  const endpoints: Record<string, string> = {};
  for (const n of log.nodes) if (n.endpoint && n.name !== CKB_SERVICE) endpoints[n.name] = n.endpoint;
  return endpoints;
}

const succeeded = (step: StepRecord) => (step.result as { error?: unknown } | null)?.error === undefined;

/** The topology a run has now, rebuilt from what its run-log says happened to it. */
export function scenarioFromLog(log: RunLog): Scenario {
  const channels: Channel[] = [];
  for (const step of log.steps.filter(succeeded)) {
    const input = step.input as Channel | null;
    if (input === null) continue;
    if (step.action === "open_channel") channels.push(input);
    if (step.action === "close_channel") {
      const index = channels.findIndex(
        (c) => (c.from === input.from && c.to === input.to) || (c.from === input.to && c.to === input.from),
      );
      if (index !== -1) channels.splice(index, 1);
    }
  }
  return parseScenario(
    { name: log.scenario, nodes: log.nodes.map((n) => n.name).filter((n) => n !== CKB_SERVICE), channels },
    log.runId,
  );
}

export async function attachRuntime(scenario: Scenario, store: RunLogStore, config: GlobalConfig): Promise<ScenarioRuntime> {
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
  const runtime = new ScenarioRuntime({ scenario, client, chain, genesis: await chain.genesis(), store, config, runId: log.runId });
  await runtime.init();
  return runtime;
}

/** The run a control command acts on: the one named, or the most recent still up. */
export async function resolveRun(runId: string | undefined): Promise<RunLog> {
  const log = runId === undefined ? await latestLiveRun() : await RunLogStore.load(runId).catch(() => null);
  if (log === null) {
    throw new CliError(
      runId === undefined ? "No run is up — start one with `fiber-lab up <scenario>`." : `Run-log "${runId}" not found.`,
      EXIT_CODES.validation,
    );
  }
  if (log.status === "reset") throw new CliError(`Run ${log.runId} has been reset.`, EXIT_CODES.validation);
  return log;
}

export async function attachRun(runId: string | undefined, config: GlobalConfig): Promise<{ store: RunLogStore; runtime: ScenarioRuntime }> {
  const log = await resolveRun(runId);
  const store = await RunLogStore.resume(log.runId);
  return { store, runtime: await attachRuntime(scenarioFromLog(log), store, config) };
}
