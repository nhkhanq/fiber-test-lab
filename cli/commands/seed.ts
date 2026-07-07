import type { Command } from "commander";
import { loadConfig } from "../../lib/config";
import { FiberClient } from "../../lib/fiber/client";
import { RunLogStore, latestRunForScenario, type RunLog } from "../../lib/runlog/store";
import { ScenarioValidationError, loadScenarioByName } from "../../lib/scenario/loader";
import { runSeedSteps } from "../../lib/scenario/seeder";

function endpointsOf(log: RunLog): Record<string, string> {
  const endpoints: Record<string, string> = {};
  for (const n of log.nodes) if (n.endpoint) endpoints[n.name] = n.endpoint;
  return endpoints;
}

export function registerSeedCommand(program: Command): void {
  program
    .command("seed <scenario>")
    .description("Chạy lại phần seed của scenario trên 1 run đang chạy")
    .option("--run <run-id>", "Run cụ thể (mặc định: run mới nhất của scenario)")
    .option("--json", "In JSON")
    .action(async (scenarioName: string, opts: { run?: string; json?: boolean }) => {
      const config = loadConfig();

      const scenario = await loadScenarioByName(scenarioName).catch((error) => {
        if (!(error instanceof ScenarioValidationError)) throw error;
        console.error(error.message);
        process.exitCode = 1;
        return null;
      });
      if (!scenario) return;

      const log = opts.run
        ? await RunLogStore.load(opts.run).catch(() => null)
        : await latestRunForScenario(scenarioName);
      if (!log) {
        console.error(
          opts.run
            ? `Không tìm thấy run-log "${opts.run}".`
            : `Không có run đang chạy cho scenario "${scenarioName}" — chạy \`fiber-lab up ${scenarioName}\` trước.`,
        );
        process.exitCode = 1;
        return;
      }

      const store = await RunLogStore.resume(log.runId);
      const client = new FiberClient({ endpoints: endpointsOf(log), logger: store.recordRpc });

      const before = store.data.steps.length;
      try {
        await runSeedSteps(scenario, client, store, config, log.runId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        store.finish("failed", message);
        await store.save();
        console.error(message);
        process.exitCode = 2;
        return;
      }
      await store.save();

      const steps = store.data.steps.slice(before);
      if (opts.json) {
        console.log(JSON.stringify(steps, null, 2));
      } else {
        console.log(`Run ${log.runId} — ${steps.length} seed step:`);
        for (const s of steps) console.log(`  ${s.action.padEnd(14)} ${JSON.stringify(s.input)} -> ${JSON.stringify(s.result)}`);
      }
    });
}
