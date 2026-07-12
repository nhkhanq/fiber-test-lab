import type { Command } from "commander";
import { loadConfig } from "../../lib/config";
import { EXIT_CODES } from "../../lib/constants";
import { CliError } from "../../lib/errors";
import { runScenario } from "../../lib/scenario/run";

export function registerUpCommand(program: Command): void {
  program
    .command("up <scenario>")
    .description("Build the topology, run the seed, and print the run-id")
    .option("--json", "Print JSON")
    .option("--keep", "Keep containers on failure for debugging")
    .action(async (scenarioName: string, opts: { json?: boolean; keep?: boolean }) => {
      const config = loadConfig();

      // ScenarioValidationError -> exit 1, DockerError -> exit 2.
      const { up, store, expectation } = await runScenario(scenarioName, config, { keep: opts.keep });

      if (expectation && !expectation.match) {
        throw new CliError(
          `Expectation mismatch: expected ${expectation.expected} but got ${expectation.actual}. Run ${up.runId} is still up — see \`fiber-lab logs ${up.runId}\`.`,
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
