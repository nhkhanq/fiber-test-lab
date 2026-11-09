import type { GlobalConfig } from "../config";
import {
  printKeepGuidance,
  shouldKeepOnFailure,
  teardownRun,
  up as dockerUp,
  type UpResult,
} from "../docker/orchestrator";
import { RunFailedError } from "../errors";
import { FiberClient } from "../fiber/client";
import type { RunLogStore } from "../runlog/store";
import { checkScenarioLimits, resolveScenario } from "./loader";
import { ScenarioRuntime } from "./runtime";
import type { Scenario, ScenarioInput } from "./schema";
import { verifyExpectation, type ExpectationResult } from "./verify";

export interface ScenarioRunResult {
  scenario: Scenario;
  up: UpResult;
  store: RunLogStore;
  runtime: ScenarioRuntime;
  expectation: ExpectationResult | null;
}

export async function runScenario(
  input: string | ScenarioInput,
  config: GlobalConfig,
  opts: { keep?: boolean } = {},
): Promise<ScenarioRunResult> {
  const scenario = await resolveScenario(input);
  checkScenarioLimits(scenario, config);
  const up = await dockerUp(scenario, config, { keep: opts.keep });

  const { store, chain, genesis, runId } = up;
  const client = new FiberClient({ endpoints: up.endpoints, logger: store.recordRpc });
  const runtime = new ScenarioRuntime({ scenario, client, chain, genesis, store, config, runId });

  try {
    await runtime.init();
    await runtime.openDeclaredChannels();
    await runtime.runSeedSteps();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.finish("failed", message);
    await store.save();
    if (shouldKeepOnFailure(config, opts.keep)) printKeepGuidance(runId);
    else await teardownRun(runId, config);
    throw new RunFailedError(message, runId);
  }

  const expectation = verifyExpectation(scenario, store.data.steps);
  if (expectation) store.recordStep("expect", { status: expectation.expected }, expectation);
  store.finish("completed");
  await store.save();

  return { scenario, up, store, runtime, expectation };
}
