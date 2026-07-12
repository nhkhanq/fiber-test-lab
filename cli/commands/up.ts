import type { Command } from "commander";
import { loadConfig } from "../../lib/config";
import { EXIT_CODES } from "../../lib/constants";
import { CliError } from "../../lib/errors";
import { runScenario } from "../../lib/scenario/run";

export function registerUpCommand(program: Command): void {
  program
    .command("up <scenario>")
    .description("Dựng topology + seed cho 1 scenario, in run-id")
    .option("--json", "In JSON")
    .option("--keep", "Không tự teardown khi lỗi (debug)")
    .action(async (scenarioName: string, opts: { json?: boolean; keep?: boolean }) => {
      const config = loadConfig();

      // ScenarioValidationError → exit 1, DockerError → exit 2 (map ở top-level handler).
      const { up, store, expectation } = await runScenario(scenarioName, config, { keep: opts.keep });

      if (expectation && !expectation.match) {
        throw new CliError(
          `Kỳ vọng không khớp: expect.status=${expectation.expected} nhưng thực tế=${expectation.actual}. Run ${up.runId} vẫn chạy — xem \`fiber-lab logs ${up.runId}\`.`,
          EXIT_CODES.expectation,
        );
      }

      if (opts.json) {
        console.log(JSON.stringify({ runId: up.runId, network: up.network, nodes: store.data.nodes }, null, 2));
      } else {
        console.log(up.runId);
      }
    });
}
