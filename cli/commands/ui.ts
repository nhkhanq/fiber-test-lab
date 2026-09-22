import { spawn } from "node:child_process";
import type { Command } from "commander";
import { EXIT_CODES } from "../../lib/constants";
import { CliError } from "../../lib/errors";
import { startUiServer } from "../../lib/report/server";

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  // Best effort: a headless machine has no browser, and that must not fail the command.
  const child = spawn(command, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" });
  child.on("error", () => {});
  child.unref();
}

export function registerUiCommand(program: Command): void {
  program
    .command("ui")
    .description("Serve the run viewer on 127.0.0.1 (read-only: reads .fiber-lab/runs/, never a node)")
    .option("--port <n>", "Port to listen on (default: a free ephemeral port)", (v) => Number(v))
    .option("--open", "Open the viewer in a browser")
    .option("--json", "Print the server's address as JSON")
    .action(async (opts: { port?: number; open?: boolean; json?: boolean }) => {
      if (opts.port !== undefined && (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535)) {
        throw new CliError(`--port must be an integer between 0 and 65535 (got "${opts.port}")`, EXIT_CODES.validation);
      }

      const server = await startUiServer({ port: opts.port }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          throw new CliError(`Port ${opts.port} is already in use.`, EXIT_CODES.runtime);
        }
        throw error;
      });

      if (opts.json) console.log(JSON.stringify({ url: server.url, port: server.port }));
      else console.log(`Run viewer on ${server.url} — Ctrl+C to stop.`);

      if (opts.open) openBrowser(server.url);

      const stop = () => {
        void server.close().then(() => process.exit(EXIT_CODES.ok));
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    });
}
