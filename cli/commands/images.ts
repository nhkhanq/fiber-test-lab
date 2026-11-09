import type { Command } from "commander";
import { loadConfig } from "../../lib/config";
import { ensureImages } from "../../lib/docker/images";

export function registerImagesCommand(program: Command): void {
  program
    .command("images")
    .description("Build or pull the lab's images ahead of time, without starting anything")
    .option("--json", "Print JSON")
    .action(async (opts: { json?: boolean }) => {
      const result = await ensureImages(loadConfig(), opts.json ? undefined : (line) => console.error(line));
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(result.images.ckb);
      console.log(result.images.fnn);
    });
}
