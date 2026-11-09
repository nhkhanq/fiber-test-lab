import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../../lib/config";
import { renderJUnit, runSuite, selectScenarios, suiteExitCode, type SuiteCase } from "../../lib/scenario/suite";

interface TestOptions {
  all?: boolean;
  tag?: string[];
  junit?: string;
  html?: boolean;
  keep?: boolean;
  json?: boolean;
}

const LABEL: Record<SuiteCase["status"], string> = { passed: "PASS", failed: "FAIL", error: "ERROR" };

function printCase(result: SuiteCase): void {
  console.log(`${LABEL[result.status].padEnd(5)} ${result.scenario} (${(result.durationMs / 1000).toFixed(1)}s)`);
  for (const message of result.messages) console.log(`      ${message}`);
  if (result.status !== "passed" && result.runId !== null) {
    console.log(`      run-log: fiber-lab logs ${result.runId}`);
  }
}

export function registerTestCommand(program: Command): void {
  program
    .command("test [scenarios...]")
    .description("Run scenarios end to end, tear each one down, and report the results")
    .option("--all", "Run every built-in scenario")
    .option("--tag <tag...>", "Run the built-in scenarios carrying any of these tags")
    .option("--junit <path>", "Also write a JUnit XML report")
    .option("--html", "Write an HTML report for each run")
    .option("--keep", "Keep the containers of a scenario that does not pass")
    .option("--json", "Print JSON")
    .action(async (names: string[], opts: TestOptions) => {
      const config = loadConfig();
      const scenarios = await selectScenarios({ names, all: opts.all, tags: opts.tag }, config);

      const result = await runSuite(scenarios, config, {
        keep: opts.keep,
        html: opts.html,
        onResult: opts.json ? undefined : printCase,
      });

      if (opts.junit !== undefined) {
        await mkdir(dirname(opts.junit), { recursive: true });
        await writeFile(opts.junit, renderJUnit(result), "utf8");
      }

      if (opts.json) {
        console.log(JSON.stringify({ fnnVersion: config.fnnVersion, ...result }, null, 2));
      } else {
        console.log(
          `\n${result.passed} passed, ${result.failed} failed, ${result.errors} errored in ${(result.durationMs / 1000).toFixed(1)}s`,
        );
      }
      process.exitCode = suiteExitCode(result);
    });
}
