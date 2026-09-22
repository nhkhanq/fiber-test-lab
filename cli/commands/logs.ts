import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Command } from "commander";
import { EXIT_CODES, RUNS_DIR } from "../../lib/constants";
import { CliError } from "../../lib/errors";
import { buildReportModel } from "../../lib/report/model";
import { renderReport } from "../../lib/report/render";
import { RunLogStore, type RunLog } from "../../lib/runlog/store";

function printSummary(log: RunLog): void {
  console.log(`Run ${log.runId} — ${log.scenario} [${log.status}]`);
  console.log(`  network:  ${log.network}`);
  console.log(`  started:  ${log.startedAt}`);
  console.log(`  finished: ${log.finishedAt ?? "-"}`);
  if (log.error) console.log(`  error:    ${log.error}`);

  console.log(`  nodes (${log.nodes.length}):`);
  for (const n of log.nodes) console.log(`    ${n.name.padEnd(8)} ${n.endpoint ?? "(no endpoint)"}`);

  console.log(`  steps (${log.steps.length}):`);
  for (const s of log.steps) {
    console.log(`    ${s.action.padEnd(14)} ${JSON.stringify(s.input)} -> ${JSON.stringify(s.result)}`);
  }
  console.log(`  rpc calls: ${log.rpcCalls.length} (use --rpc for details)`);
}

function printRpc(log: RunLog): void {
  console.log(`Run ${log.runId} — ${log.rpcCalls.length} RPC calls:`);
  for (const r of log.rpcCalls) {
    console.log(`  [${r.at}] ${r.node} ${r.method}`);
    console.log(`    params:   ${JSON.stringify(r.params)}`);
    if (r.error != null) console.log(`    error:    ${JSON.stringify(r.error)}`);
    else console.log(`    response: ${JSON.stringify(r.response)}`);
  }
}

async function writeHtml(log: RunLog, target: string | true): Promise<string> {
  const path = typeof target === "string" ? target : join(RUNS_DIR, `${log.runId}.html`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, renderReport(buildReportModel(log)), "utf8");
  return path;
}

export function registerLogsCommand(program: Command): void {
  program
    .command("logs <run-id>")
    .description(
      "Print a run-log: step/status summary (default), all RPCs (--rpc), raw JSON (--json), or an HTML report (--html)",
    )
    .option("--json", "Print the full run-log JSON")
    .option("--rpc", "Print every RPC call")
    .option(
      "--html [path]",
      `Write a self-contained HTML report (default: ${RUNS_DIR}/<run-id>.html)`,
    )
    .action(async (runId: string, opts: { json?: boolean; rpc?: boolean; html?: string | true }) => {
      const log = await RunLogStore.load(runId).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new CliError(`Run-log "${runId}" not found (in .fiber-lab/runs/).`, EXIT_CODES.validation);
        }
        throw error;
      });

      if (opts.html !== undefined) {
        const path = await writeHtml(log, opts.html);
        if (opts.json) console.log(JSON.stringify({ runId: log.runId, report: path }));
        else console.log(`Wrote ${path}`);
        return;
      }

      if (opts.json) console.log(JSON.stringify(log, null, 2));
      else if (opts.rpc) printRpc(log);
      else printSummary(log);
    });
}
