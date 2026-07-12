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
import { loadScenarioByName } from "./loader";
import type { Scenario } from "./schema";
import { runSeed } from "./seeder";
import { verifyExpectation, type ExpectationResult } from "./verify";

export interface ScenarioRunResult {
  scenario: Scenario;
  up: UpResult;
  store: RunLogStore;
  expectation: ExpectationResult | null;
}

/**
 * Dựng + seed + verify 1 scenario end-to-end, KHÔNG teardown khi thành công (caller quyết reset).
 * Seed lỗi runtime → teardown/keep + throw CliError(2). Expect lệch → trả về (không throw) để caller xử.
 * Dùng chung bởi `fiber-lab up` và test-kit/determinism.
 */
export async function runScenario(
  name: string,
  config: GlobalConfig,
  opts: { keep?: boolean } = {},
): Promise<ScenarioRunResult> {
  const scenario = await loadScenarioByName(name);
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
