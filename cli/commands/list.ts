import type { Command } from "commander";
import { listRuns } from "../../lib/runlog/store";
import { listScenarios } from "../../lib/scenario/loader";

export function registerListCommand(program: Command): void {
  program
    .command("list")
    .description("List all scenarios and runs")
    .option("--json", "Print JSON")
    .action(async (opts: { json?: boolean }) => {
      const [scenarios, runs] = await Promise.all([listScenarios(), listRuns()]);

      if (opts.json) {
        console.log(JSON.stringify({ scenarios, runs }, null, 2));
        return;
      }

      console.log("Scenarios:");
      if (scenarios.length === 0) console.log("  (none)");
      for (const s of scenarios) {
        const label = s.valid ? s.description || "(no description)" : `INVALID — ${s.error}`;
        console.log(`  ${s.name.padEnd(24)} ${label}`);
      }

      console.log("\nRuns:");
      if (runs.length === 0) console.log("  (none)");
      for (const r of runs) {
        console.log(`  ${r.runId.padEnd(16)} ${r.scenario.padEnd(20)} ${r.status.padEnd(10)} ${r.startedAt}`);
      }
    });
}
