import type { GlobalConfig } from "../config";
import { EXIT_CODES } from "../constants";
import {
  printKeepGuidance,
  shouldKeepOnFailure,
  teardown,
  up as dockerUp,
  type UpResult,
} from "../docker/orchestrator";
import { CliError } from "../errors";
import { FiberClient } from "../fiber/client";
import { RunLogStore } from "../runlog/store";
import { loadScenario } from "./loader";
import type { Scenario } from "./schema";
import { runSeed } from "./seeder";
import { verifyExpectation, type ExpectationResult } from "./verify";

export interface ScenarioRunResult {
  scenario: Scenario;
  up: UpResult;
  store: RunLogStore;
  expectation: ExpectationResult | null;
}

export async function runScenario(
  nameOrPath: string,
  config: GlobalConfig,
  opts: { keep?: boolean } = {},
): Promise<ScenarioRunResult> {
  const scenario = await loadScenario(nameOrPath);
  const up = await dockerUp(scenario, config, { keep: opts.keep });

  const store = await RunLogStore.resume(up.runId);
  const client = new FiberClient({ endpoints: up.endpoints, logger: store.recordRpc });

  if (scenario.channels.length > 0 || scenario.seed.length > 0) {
    try {
      await runSeed(scenario, client, store, config, up.runId, up.ckbEndpoint);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.finish("failed", message);
      await store.save();
      if (shouldKeepOnFailure(config, opts.keep)) printKeepGuidance(up.runId);
      else await teardown(up.project, up.network, up.composeFile);
      throw new CliError(message, EXIT_CODES.runtime);
    }
  }

  const expectation = verifyExpectation(scenario, store.data.steps);
  if (expectation) store.recordStep("expect", { status: expectation.expected }, expectation);
  store.finish("completed");
  await store.save();

  return { scenario, up, store, expectation };
}
