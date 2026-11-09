import type { Command } from "commander";
import { loadConfig } from "../../lib/config";
import { removeLabImages } from "../../lib/docker/images";
import { reset as resetRun, resetAll } from "../../lib/docker/orchestrator";

export function registerResetCommand(program: Command): void {
  program
    .command("reset [run-id]")
    .description("Tear down one run (by run-id) or all runs (--all / no argument)")
    .option("--all", "Clean up every Test Lab run")
    .option("--images", "Also delete the Docker images the lab has built")
    .option("--json", "Print JSON")
    .action(async (runId: string | undefined, opts: { all?: boolean; images?: boolean; json?: boolean }) => {
      const config = loadConfig();

      let cleaned: string[];
      if (runId && !opts.all) {
        await resetRun(runId, config);
        cleaned = [runId];
      } else {
        cleaned = await resetAll(config);
      }
      const images = opts.images ? await removeLabImages(config) : [];

      if (opts.json) {
        console.log(JSON.stringify({ cleaned, images }, null, 2));
        return;
      }

      if (cleaned.length === 0) {
        console.log("No runs to clean up.");
      } else {
        console.log(`Cleaned up ${cleaned.length} run(s):`);
        for (const id of cleaned) console.log(`  ${id}`);
      }
      if (opts.images) console.log(`Removed ${images.length} image(s).`);
    });
}
