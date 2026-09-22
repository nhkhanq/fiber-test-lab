#!/usr/bin/env -S npx tsx
import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { exitCodeFor } from "../lib/errors";
import { registerListCommand } from "./commands/list";
import { registerLogsCommand } from "./commands/logs";
import { registerResetCommand } from "./commands/reset";
import { registerSeedCommand } from "./commands/seed";
import { registerUpCommand } from "./commands/up";

const program = new Command();
program
  .name("fiber-lab")
  .description("Fully-local test environment for Fiber Network payment/routing scenarios")
  .version(pkg.version);

registerListCommand(program);
registerUpCommand(program);
registerResetCommand(program);
registerLogsCommand(program);
registerSeedCommand(program);

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = exitCodeFor(error);
});
