import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { GlobalConfig } from "../config";
import { CKB_RPC_PORT, CKB_SERVICE, FNN_RPC_PORT, WORK_DIR } from "../constants";
import { generateNodeConfigs } from "../fiber/nodeConfig";
import { RunLogStore, type NodeRecord } from "../runlog/store";
import type { Scenario } from "../scenario/schema";
import {
  buildComposeProject,
  containerName,
  networkName,
  renderComposeYaml,
  type ComposeProject,
} from "../../topology/compose.template";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class DockerError extends Error {
  constructor(message: string, readonly stderr = "") {
    super(message);
    this.name = "DockerError";
  }
}

export interface DockerResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Called with each complete line docker prints, as it prints it. `docker compose` reports its
 *  progress on stderr, and it only makes sense live: buffering it to the end is how a 40-second
 *  image build looks like nothing happening at all. */
export type LineHandler = (line: string) => void;

function docker(args: string[], onLine?: LineHandler): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { cwd: process.cwd() });
    let stdout = "";
    let stderr = "";

    const streamLines = (): ((chunk: string) => void) => {
      let partial = "";
      return (chunk: string) => {
        partial += chunk;
        const lines = partial.split("\n");
        partial = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.length > 0) onLine?.(trimmed);
        }
      };
    };
    const onOut = streamLines();
    const onErr = streamLines();

    child.stdout.on("data", (d) => {
      const text = d.toString();
      stdout += text;
      if (onLine) onOut(text);
    });
    child.stderr.on("data", (d) => {
      const text = d.toString();
      stderr += text;
      if (onLine) onErr(text);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

function newRunId(): string {
  return Date.now().toString(36) + randomBytes(3).toString("hex");
}

async function networkExists(name: string): Promise<boolean> {
  const r = await docker(["network", "ls", "--filter", `name=^${name}$`, "--format", "{{.Name}}"]);
  return r.stdout.split(/\s+/).includes(name);
}

async function fileExists(path: string): Promise<boolean> {
  return access(path)
    .then(() => true)
    .catch(() => false);
}

function composeFilePath(runId: string): string {
  return join(WORK_DIR, `${runId}.yml`);
}

async function uniqueRunId(config: GlobalConfig): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const id = newRunId();
    if (!(await networkExists(networkName(config, id))) && !(await fileExists(join(WORK_DIR, `${id}.yml`)))) {
      return id;
    }
  }
  throw new Error("Could not generate a unique run-id after 5 attempts");
}

export async function teardown(project: string, network: string, composeFile?: string): Promise<void> {
  const downArgs = ["compose", "-p", project];
  if (composeFile && (await fileExists(composeFile))) downArgs.push("-f", composeFile);
  downArgs.push("down", "-v", "--remove-orphans", "--timeout", "10");
  await docker(downArgs);

  const ps = await docker(["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`]);
  const ids = ps.stdout.split(/\s+/).filter(Boolean);
  if (ids.length) await docker(["rm", "-f", ...ids]);

  if (await networkExists(network)) await docker(["network", "rm", network]);
}

export async function composeUp(params: {
  project: string;
  composeFile: string;
  composeYaml: string;
  build?: boolean;
  onLine?: LineHandler;
}): Promise<DockerResult> {
  await mkdir(dirname(params.composeFile), { recursive: true });
  await writeFile(params.composeFile, params.composeYaml, "utf8");
  const args = [
    "compose",
    "--project-directory",
    process.cwd(),
    "-p",
    params.project,
    "-f",
    params.composeFile,
    "up",
    "-d",
  ];
  if (params.build) args.push("--build");
  return docker(args, params.onLine);
}

async function containerHealth(container: string): Promise<string> {
  const r = await docker([
    "inspect",
    "--format",
    "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
    container,
  ]);
  return r.stdout.trim();
}

export interface ReadyProgress {
  ready: string[];
  pending: string[];
}

export async function waitForReady(
  containers: string[],
  config: GlobalConfig,
  onProgress?: (progress: ReadyProgress) => void,
): Promise<void> {
  const deadline = Date.now() + config.pollTimeoutMs;
  const pending = new Set(containers);
  const report = () =>
    onProgress?.({
      ready: containers.filter((c) => !pending.has(c)),
      pending: [...pending],
    });

  report();
  while (pending.size > 0) {
    for (const c of [...pending]) {
      if ((await containerHealth(c)) === "healthy") {
        pending.delete(c);
        report();
      }
    }
    if (pending.size === 0) return;
    if (Date.now() > deadline) {
      throw new DockerError(`Timed out after ${config.pollTimeoutMs}ms waiting for READY: ${[...pending].join(", ")}`);
    }
    await sleep(config.pollIntervalMs);
  }
}

export async function killNode(container: string): Promise<void> {
  const r = await docker(["kill", container]);
  if (r.code !== 0) throw new DockerError(`docker kill failed (${container})`, r.stderr);
}

export async function startNode(container: string, config: GlobalConfig): Promise<void> {
  const r = await docker(["start", container]);
  if (r.code !== 0) throw new DockerError(`docker start failed (${container})`, r.stderr);
  await waitForReady([container], config);
}

export function shouldKeepOnFailure(config: GlobalConfig, keepFlag?: boolean): boolean {
  return Boolean(keepFlag) || config.keepRunOnFailure;
}

export function printKeepGuidance(runId: string): void {
  console.error(`Keeping run ${runId} for debugging — see \`fiber-lab logs ${runId}\` or clean up with \`fiber-lab reset ${runId}\`.`);
}

async function hostEndpoint(container: string, port: number): Promise<string | null> {
  const r = await docker(["port", container, String(port)]);
  const hostPort = r.stdout.trim().split("\n")[0]?.match(/:(\d+)$/)?.[1];
  return hostPort ? `http://127.0.0.1:${hostPort}` : null;
}

/** ` Container flab_<run>_ckb  Started` / ` Image flab_<run>-alice  Built` — compose's progress
 *  lines. Anything that does not match this shape is not progress and is left alone. */
const COMPOSE_PROGRESS =
  /^(Container|Image|Network|Volume)\s+(\S+)\s+(Building|Built|Creating|Created|Starting|Started|Waiting|Healthy|Running|Pulling|Pulled|Recreate|Recreated|Error.*)$/;

export interface ComposeProgress {
  latest: string;
  containersStarted: number;
  imagesBuilt: number;
}

export function parseComposeProgress(line: string): { resource: string; name: string; state: string } | null {
  const match = COMPOSE_PROGRESS.exec(line);
  if (match === null) return null;
  return { resource: match[1]!, name: match[2]!, state: match[3]! };
}

export interface UpResult {
  runId: string;
  project: string;
  network: string;
  nodes: string[];
  endpoints: Record<string, string>;
  ckbEndpoint: string | null;
  composeFile: string;
}

export async function up(
  scenario: Scenario,
  config: GlobalConfig,
  opts: { keep?: boolean } = {},
): Promise<UpResult> {
  const runId = await uniqueRunId(config);
  const project: ComposeProject = buildComposeProject(scenario, runId, config);
  const network = networkName(config, runId);
  const composeFile = composeFilePath(runId);

  const nodes: NodeRecord[] = Object.keys(project.services).map((name) => ({
    name,
    container: containerName(config, runId, name),
    endpoint: null,
  }));
  const store = RunLogStore.create({ runId, scenario: scenario.name, network, nodes });
  await store.save();

  await generateNodeConfigs(scenario, runId);

  // Each phase is recorded as it starts and updated as it runs, so `fiber-lab ui` shows an image
  // build in progress rather than a blank page for its whole 40 seconds.
  const composeStep = store.beginStep("docker_up", { services: Object.keys(project.services) });
  const built = new Set<string>();
  const started = new Set<string>();

  const result = await composeUp({
    project: project.name,
    composeFile,
    composeYaml: renderComposeYaml(project),
    build: true,
    onLine: (line) => {
      const progress = parseComposeProgress(line);
      if (progress === null) return;
      if (progress.resource === "Image" && progress.state === "Built") built.add(progress.name);
      if (progress.resource === "Container" && (progress.state === "Started" || progress.state === "Running")) {
        started.add(progress.name);
      }
      composeStep.update({
        latest: line,
        imagesBuilt: built.size,
        containersStarted: started.size,
      } satisfies ComposeProgress);
    },
  });

  if (result.code !== 0) {
    composeStep.end({ failed: true, stderr: result.stderr.trim().split("\n").slice(-5) });
    store.finish("failed", result.stderr.trim() || `docker compose up exit ${result.code}`);
    await store.save();
    if (shouldKeepOnFailure(config, opts.keep)) printKeepGuidance(runId);
    else await teardown(project.name, network, composeFile);
    throw new DockerError(`docker compose up failed (run ${runId})`, result.stderr);
  }

  composeStep.end({ imagesBuilt: built.size, containersStarted: started.size });

  const readyStep = store.beginStep("wait_ready", {
    containers: Object.keys(project.services).map((n) => containerName(config, runId, n)),
  });
  try {
    await waitForReady(
      Object.keys(project.services).map((n) => containerName(config, runId, n)),
      config,
      (progress) => readyStep.update(progress),
    );
    readyStep.end();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    readyStep.end({ error: msg });
    store.finish("failed", msg);
    await store.save();
    if (shouldKeepOnFailure(config, opts.keep)) printKeepGuidance(runId);
    else await teardown(project.name, network, composeFile);
    throw e;
  }

  const endpoints: Record<string, string> = {};
  for (const node of scenario.nodes) {
    const ep = await hostEndpoint(containerName(config, runId, node), FNN_RPC_PORT);
    if (ep) {
      endpoints[node] = ep;
      const rec = store.data.nodes.find((n) => n.name === node);
      if (rec) rec.endpoint = ep;
    }
  }
  const ckbEndpoint = await hostEndpoint(containerName(config, runId, CKB_SERVICE), CKB_RPC_PORT);

  await store.save();

  return {
    runId,
    project: project.name,
    network,
    nodes: scenario.nodes.filter((n) => n !== CKB_SERVICE),
    endpoints,
    ckbEndpoint,
    composeFile,
  };
}

export async function reset(runId: string, config: GlobalConfig): Promise<void> {
  const network = networkName(config, runId);
  await teardown(network, network, composeFilePath(runId)); // project name == network
  if (await fileExists(join(process.cwd(), ".fiber-lab/runs", `${runId}.json`))) {
    await RunLogStore.setStatus(runId, "reset").catch((error) => {
      console.error(`Warning: could not update run-log for ${runId} (${(error as Error).message}). Docker resources were still cleaned up.`);
    });
  }
  await rm(composeFilePath(runId), { force: true });
}

export async function resetAll(config: GlobalConfig): Promise<string[]> {
  const ids = new Set<string>();

  const runFiles = await readdir(".fiber-lab/runs").catch(() => [] as string[]);
  for (const f of runFiles) if (f.endsWith(".json")) ids.add(f.slice(0, -5));

  const prefix = `${config.dockerNetworkPrefix}_`;
  const nets = await docker(["network", "ls", "--filter", `name=${prefix}`, "--format", "{{.Name}}"]);
  for (const n of nets.stdout.split(/\s+/).filter(Boolean)) {
    if (n.startsWith(prefix)) ids.add(n.slice(prefix.length));
  }

  for (const id of ids) await reset(id, config);
  return [...ids];
}
