import type { Command } from "commander";
import { loadConfig } from "../../lib/config";
import { reset as resetRun, resetAll } from "../../lib/docker/orchestrator";

export function registerResetCommand(program: Command): void {
  program
    .command("reset [run-id]")
    .description("Teardown 1 run (theo run-id) hoặc tất cả (--all / không tham số)")
    .option("--all", "Dọn tất cả run của Test Lab")
    .option("--json", "In JSON")
    .action(async (runId: string | undefined, opts: { all?: boolean; json?: boolean }) => {
      const config = loadConfig();

      let cleaned: string[];
      if (runId && !opts.all) {
        await resetRun(runId, config);
        cleaned = [runId];
      } else {
        cleaned = await resetAll(config);
      }

      if (opts.json) {
        console.log(JSON.stringify({ cleaned }, null, 2));
        return;
      }

      if (cleaned.length === 0) {
        console.log("Không có run nào để dọn.");
        return;
      }
      console.log(`Đã dọn ${cleaned.length} run:`);
      for (const id of cleaned) console.log(`  ${id}`);
    });
}
