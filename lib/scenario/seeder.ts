import type { GlobalConfig } from "../config";
import type { RunLogStore } from "../runlog/store";
import { attachRuntime } from "./attach";
import type { Scenario } from "./schema";

/** Re-run a scenario's seed against a run that is already up (`fiber-lab seed`). */
export async function reseed(scenario: Scenario, store: RunLogStore, config: GlobalConfig): Promise<void> {
  const runtime = await attachRuntime(scenario, store, config);
  await runtime.repeatSeedSteps();
}
