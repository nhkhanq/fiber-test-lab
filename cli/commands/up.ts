import type { Command } from "commander";
import { loadConfig } from "../../lib/config";
import { shouldKeepOnFailure, teardown, up as dockerUp } from "../../lib/docker/orchestrator";
import { FiberClient } from "../../lib/fiber/client";
import { RunLogStore } from "../../lib/runlog/store";
import { ScenarioValidationError, loadScenarioByName } from "../../lib/scenario/loader";
import { runSeed } from "../../lib/scenario/seeder";

export function registerUpCommand(program: Command): void {
  program
    .command("up <scenario>")
    .description("Dựng topology + seed cho 1 scenario, in run-id")
    .option("--json", "In JSON")
    .option("--keep", "Không tự teardown khi lỗi (debug)")
    .action(async (scenarioName: string, opts: { json?: boolean; keep?: boolean }) => {
      const config = loadConfig();

      const scenario = await loadScenarioByName(scenarioName).catch((error) => {
        if (!(error instanceof ScenarioValidationError)) throw error;
        console.error(error.message);
        process.exitCode = 1;
        return null;
      });
      if (!scenario) return;

      const upResult = await dockerUp(scenario, config, { keep: opts.keep }).catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 2;
        return null;
      });
      if (!upResult) return;

      const store = await RunLogStore.resume(upResult.runId);
      const client = new FiberClient({ endpoints: upResult.endpoints, logger: store.recordRpc });

      if (scenario.channels.length > 0 || scenario.seed.length > 0) {
        try {
          await runSeed(scenario, client, store, config, upResult.runId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          store.finish("failed", message);
          await store.save();
          if (shouldKeepOnFailure(config, opts.keep)) {
            console.error(
              `Giữ lại run ${upResult.runId} để debug — xem \`fiber-lab logs ${upResult.runId}\` hoặc dọn bằng \`fiber-lab reset ${upResult.runId}\`.`,
            );
          } else {
            await teardown(upResult.project, upResult.network, upResult.composeFile);
          }
          console.error(message);
          process.exitCode = 2;
          return;
        }
      }

      store.finish("completed");
      await store.save();

      if (opts.json) {
        console.log(JSON.stringify({ runId: upResult.runId, network: upResult.network, nodes: store.data.nodes }, null, 2));
      } else {
        console.log(upResult.runId);
      }
    });
}
