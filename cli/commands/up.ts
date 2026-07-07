import type { Command } from "commander";
import { loadConfig } from "../../lib/config";
import { EXIT_CODES } from "../../lib/constants";
import { shouldKeepOnFailure, teardown, up as dockerUp } from "../../lib/docker/orchestrator";
import { CliError } from "../../lib/errors";
import { FiberClient } from "../../lib/fiber/client";
import { RunLogStore } from "../../lib/runlog/store";
import { loadScenarioByName } from "../../lib/scenario/loader";
import { runSeed } from "../../lib/scenario/seeder";
import { verifyExpectation } from "../../lib/scenario/verify";

export function registerUpCommand(program: Command): void {
  program
    .command("up <scenario>")
    .description("Dựng topology + seed cho 1 scenario, in run-id")
    .option("--json", "In JSON")
    .option("--keep", "Không tự teardown khi lỗi (debug)")
    .action(async (scenarioName: string, opts: { json?: boolean; keep?: boolean }) => {
      const config = loadConfig();

      // ScenarioValidationError → exit 1, DockerError → exit 2 (map ở top-level handler).
      const scenario = await loadScenarioByName(scenarioName);
      const upResult = await dockerUp(scenario, config, { keep: opts.keep });

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
          throw new CliError(message, EXIT_CODES.runtime);
        }
      }

      const expectation = verifyExpectation(scenario, store.data.steps);
      if (expectation) store.recordStep("expect", { status: expectation.expected }, expectation);
      store.finish("completed");
      await store.save();

      if (expectation && !expectation.match) {
        throw new CliError(
          `Kỳ vọng không khớp: expect.status=${expectation.expected} nhưng thực tế=${expectation.actual}. Run ${upResult.runId} vẫn chạy — xem \`fiber-lab logs ${upResult.runId}\`.`,
          EXIT_CODES.expectation,
        );
      }

      if (opts.json) {
        console.log(JSON.stringify({ runId: upResult.runId, network: upResult.network, nodes: store.data.nodes }, null, 2));
      } else {
        console.log(upResult.runId);
      }
    });
}
