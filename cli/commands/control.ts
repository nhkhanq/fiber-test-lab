import { Argument, type Command } from "commander";
import { loadConfig } from "../../lib/config";
import { EXIT_CODES } from "../../lib/constants";
import { runDoctor } from "../../lib/docker/doctor";
import { CliError } from "../../lib/errors";
import { attachRun, resolveRun } from "../../lib/scenario/attach";
import { describeEnvironment, renderDotenv } from "../../lib/scenario/environment";
import type { ScenarioRuntime } from "../../lib/scenario/runtime";

interface ControlOptions {
  run?: string;
  json?: boolean;
}

/** Control commands exist so a test in any language can force a state at the moment it needs it.
 *  Each one attaches to the run, acts through the runtime, and lands in the run-log. */
async function control(opts: ControlOptions, act: (runtime: ScenarioRuntime) => Promise<Record<string, unknown>>): Promise<void> {
  const { store, runtime } = await attachRun(opts.run, loadConfig());
  const result = await act(runtime);
  await store.save();
  if (opts.json) console.log(JSON.stringify({ runId: store.data.runId, ...result }, null, 2));
  else console.log(Object.values(result).join(" "));
}

const positiveInt = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new CliError(`"${value}" is not a positive whole number.`, EXIT_CODES.validation);
  return parsed;
};

const withRunOptions = (command: Command): Command =>
  command.option("--run <run-id>", "Target a specific run (default: the most recent one still up)").option("--json", "Print JSON");

export function registerControlCommands(program: Command): void {
  program
    .command("env [run-id]")
    .description("Print what a client needs to use a run: endpoints, keys and devnet hashes")
    .option("--json", "Print JSON")
    .option("--dotenv", "Print KEY=value lines")
    .action(async (runId: string | undefined, opts: { json?: boolean; dotenv?: boolean }) => {
      const environment = describeEnvironment(await resolveRun(runId));
      if (opts.dotenv) {
        process.stdout.write(renderDotenv(environment));
      } else if (opts.json) {
        console.log(JSON.stringify(environment, null, 2));
      } else {
        console.log(`Run ${environment.runId} — ${environment.scenario} [${environment.status}]`);
        console.log(`  ckb       ${environment.ckb.rpc ?? "-"}`);
        for (const node of Object.values(environment.nodes)) console.log(`  ${node.name.padEnd(9)} ${node.rpc ?? "-"}`);
      }
    });

  withRunOptions(
    program
      .command("node")
      .description("Kill, start, freeze or unfreeze a node of a running run")
      .addArgument(new Argument("<action>").choices(["kill", "start", "pause", "resume"]))
      .argument("<node>"),
  ).action(async (action: string, node: string, opts: ControlOptions) => {
    await control(opts, async (runtime) => {
      if (action === "kill") await runtime.killNode(node);
      if (action === "start") await runtime.startNode(node);
      if (action === "pause") await runtime.pauseNode(node);
      if (action === "resume") await runtime.resumeNode(node);
      return { action, node };
    });
  });

  withRunOptions(
    program
      .command("peer")
      .description("Disconnect or reconnect two nodes of a running run")
      .addArgument(new Argument("<action>").choices(["disconnect", "connect"]))
      .argument("<from>")
      .argument("<to>"),
  ).action(async (action: string, from: string, to: string, opts: ControlOptions) => {
    await control(opts, async (runtime) => {
      if (action === "disconnect") await runtime.disconnectPeer(from, to);
      else await runtime.connectPeer(from, to);
      return { action, from, to };
    });
  });

  withRunOptions(
    program
      .command("chain")
      .description("Read or advance the devnet of a running run")
      .addArgument(new Argument("<action>").choices(["tip", "mine", "epochs"]))
      .argument("[count]", "How many blocks or epochs", "1"),
  ).action(async (action: string, count: string, opts: ControlOptions) => {
    await control(opts, async (runtime) => {
      const amount = positiveInt(count);
      const tip =
        action === "mine" ? await runtime.mine(amount) : action === "epochs" ? await runtime.advanceEpochs(amount) : await runtime.chain.tip();
      return { tip: tip.toString() };
    });
  });

  withRunOptions(
    program
      .command("channel")
      .description("Open or close a channel on a running run")
      .addArgument(new Argument("<action>").choices(["open", "close"]))
      .argument("<from>")
      .argument("<to>")
      .argument("[capacity]", "CKB to fund the channel with, for open")
      .option("--force", "For close: a unilateral close"),
  ).action(async (action: string, from: string, to: string, capacity: string | undefined, opts: ControlOptions & { force?: boolean }) => {
    await control(opts, async (runtime) => {
      if (action === "open") {
        const { channelId } = await runtime.openChannel({ from, to, capacity: positiveInt(capacity ?? "") });
        return { channelId };
      }
      const closed = await runtime.closeChannel({ from, to, force: opts.force });
      if (!closed.ok) throw new CliError(closed.error ?? "close failed", EXIT_CODES.runtime);
      return { channelId: closed.channelId, flags: closed.flags };
    });
  });

  program
    .command("doctor")
    .description("Check that this machine can run the lab")
    .option("--json", "Print JSON")
    .action(async (opts: { json?: boolean }) => {
      const checks = await runDoctor(loadConfig().fnnVersion);
      if (opts.json) console.log(JSON.stringify({ platform: `${process.platform}/${process.arch}`, checks }, null, 2));
      else {
        console.log(`platform        ${process.platform}/${process.arch}`);
        for (const check of checks) console.log(`${check.name.padEnd(15)} ${check.ok ? "ok" : "FAIL"}  ${check.detail}`);
      }
      if (checks.some((c) => !c.ok)) process.exitCode = EXIT_CODES.runtime;
    });
}

