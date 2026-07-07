import type { Command } from "commander";
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
  console.log(`  rpc calls: ${log.rpcCalls.length} (dùng --rpc để xem chi tiết)`);
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

export function registerLogsCommand(program: Command): void {
  program
    .command("logs <run-id>")
    .description("In run-log: tóm tắt step + status (mặc định), mọi RPC (--rpc), JSON thô (--json)")
    .option("--json", "In nguyên run-log JSON")
    .option("--rpc", "In đầy đủ mọi RPC call")
    .action(async (runId: string, opts: { json?: boolean; rpc?: boolean }) => {
      const log = await RunLogStore.load(runId).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          console.error(`Không tìm thấy run-log "${runId}" (trong .fiber-lab/runs/).`);
          process.exitCode = 1;
          return null;
        }
        throw error;
      });
      if (!log) return;

      if (opts.json) console.log(JSON.stringify(log, null, 2));
      else if (opts.rpc) printRpc(log);
      else printSummary(log);
    });
}
