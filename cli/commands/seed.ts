import type { Command } from "commander";
import { loadConfig } from "../../lib/config";
import { EXIT_CODES } from "../../lib/constants";
import { CliError } from "../../lib/errors";
import { RunLogStore, latestRunForScenario } from "../../lib/runlog/store";
import { loadScenario } from "../../lib/scenario/loader";
import { reseed } from "../../lib/scenario/seeder";

export function registerSeedCommand(program: Command): void {
  program
    .command("seed <scenario>")
    .description("Re-run a scenario's seed steps against a running run")
    .option("--run <run-id>", "Target a specific run (default: the scenario's latest run)")
    .option("--json", "Print JSON")
    .action(async (scenarioName: string, opts: { run?: string; json?: boolean }) => {
      const config = loadConfig();

      // A bad schema throws ScenarioValidationError, which bubbles up to exit 1.
      const scenario = await loadScenario(scenarioName);

      const log = opts.run
        ? await RunLogStore.load(opts.run).catch(() => null)
        : await latestRunForScenario(scenarioName);
      if (!log) {
        throw new CliError(
          opts.run
            ? `Run-log "${opts.run}" not found.`
            : `No running run for scenario "${scenarioName}" — run \`fiber-lab up ${scenarioName}\` first.`,
          EXIT_CODES.validation,
        );
      }

      const store = await RunLogStore.resume(log.runId);

      const before = store.data.steps.length;
      try {
        await reseed(scenario, store, config);
      } catch (error) {
        if (error instanceof CliError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        store.finish("failed", message);
        await store.save();
        throw new CliError(message, EXIT_CODES.runtime);
      }
      await store.save();

      const steps = store.data.steps.slice(before);
      if (opts.json) {
        console.log(JSON.stringify(steps, null, 2));
      } else {
        console.log(`Run ${log.runId} — ${steps.length} seed step(s):`);
        for (const s of steps) console.log(`  ${s.action.padEnd(14)} ${JSON.stringify(s.input)} -> ${JSON.stringify(s.result)}`);
      }
    });
}
