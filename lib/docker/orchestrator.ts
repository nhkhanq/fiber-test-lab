import { randomBytes } from "node:crypto";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CkbChain, type GenesisFacts } from "../ckb/chain";
import type { GlobalConfig } from "../config";
import { CKB_RPC_PORT, CKB_SERVICE, CKB_VERSION, FNN_RPC_PORT, RECOMMENDED_MAX_NODES, WORK_DIR } from "../constants";
import { RunFailedError } from "../errors";
import { generateNodeConfigs } from "../fiber/nodeConfig";
import { listRuns, RunLogStore, type NodeRecord } from "../runlog/store";
import type { Scenario } from "../scenario/schema";
import {
  buildComposeProject,
  containerName,
  networkName,
  renderComposeYaml,
  type ComposeProject,
} from "../../topology/compose.template";
import { docker, DockerError, type DockerResult, type LineHandler } from "./exec";
import { ensureImages, type LabImages } from "./images";

export { DockerError };
export type { DockerResult, LineHandler };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/** Remove everything a run created: containers, network, compose file and node directories. */
export async function teardownRun(runId: string, config: GlobalConfig): Promise<void> {
  const network = networkName(config, runId); // the compose project is named after the network
  const composeFile = composeFilePath(runId);

  const downArgs = ["compose", "-p", network];
  if (await fileExists(composeFile)) downArgs.push("-f", composeFile);
  downArgs.push("down", "-v", "--remove-orphans", "--timeout", "10");
  await docker(downArgs);

  const ps = await docker(["ps", "-aq", "--filter", `label=com.docker.compose.project=${network}`]);
  const ids = ps.stdout.split(/\s+/).filter(Boolean);
  if (ids.length) await docker(["rm", "-f", ...ids]);

  if (await networkExists(network)) await docker(["network", "rm", network]);

  const workDir = join(WORK_DIR, runId);
  await rm(workDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch((error) => {
    console.error(`Warning: could not remove ${workDir} (${(error as Error).message}).`);
  });
  await rm(composeFile, { force: true });
}

export async function composeUp(params: {
  project: string;
  composeFile: string;
  composeYaml: string;
  services?: string[];
  onLine?: LineHandler;
}): Promise<DockerResult> {
  await mkdir(dirname(params.composeFile), { recursive: true });
  await writeFile(params.composeFile, params.composeYaml, "utf8");
  return docker(
    [
      "compose",
      "--project-directory",
      process.cwd(),
      "-p",
      params.project,
      "-f",
      params.composeFile,
      "up",
      "-d",
      ...(params.services ?? []),
    ],
    params.onLine,
  );
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

export async function startNode(container: string, config: GlobalConfig): Promise<string | null> {
  const r = await docker(["start", container]);
  if (r.code !== 0) throw new DockerError(`docker start failed (${container})`, r.stderr);
  await waitForReady([container], config);
  return hostEndpoint(container, FNN_RPC_PORT);
}

export async function pauseNode(container: string): Promise<void> {
  const r = await docker(["pause", container]);
  if (r.code !== 0) throw new DockerError(`docker pause failed (${container})`, r.stderr);
}

export async function resumeNode(container: string): Promise<void> {
  const r = await docker(["unpause", container]);
  if (r.code !== 0) throw new DockerError(`docker unpause failed (${container})`, r.stderr);
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

/** ` Container flab_<run>_ckb  Started` — compose's progress lines. Anything that does not match
 *  this shape is not progress and is left alone. */
const COMPOSE_PROGRESS =
  /^(Container|Image|Network|Volume)\s+(\S+)\s+(Building|Built|Creating|Created|Starting|Started|Waiting|Healthy|Running|Pulling|Pulled|Recreate|Recreated|Error.*)$/;

export interface ComposeProgress {
  latest: string;
  containersStarted: number;
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
  ckbEndpoint: string;
  composeFile: string;
  store: RunLogStore;
  chain: CkbChain;
  genesis: GenesisFacts;
}

interface RunContext {
  runId: string;
  scenario: Scenario;
  config: GlobalConfig;
  store: RunLogStore;
  network: string;
  composeFile: string;
}

async function buildImages(run: RunContext): Promise<LabImages> {
  const step = run.store.beginStep("build_images", { fnn: run.config.fnnVersion, ckb: CKB_VERSION });
  try {
    const result = await ensureImages(run.config, (latest) => step.update({ latest }));
    step.end({ images: result.images, built: result.built, pulled: result.pulled });
    return result.images;
  } catch (error) {
    step.end({ error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function startServices(run: RunContext, project: ComposeProject, services: string[]): Promise<void> {
  const { store, config, runId, composeFile } = run;
  const composeStep = store.beginStep("docker_up", { services });
  const started = new Set<string>();

  const result = await composeUp({
    project: project.name,
    composeFile,
    composeYaml: renderComposeYaml(project),
    services,
    onLine: (line) => {
      const progress = parseComposeProgress(line);
      if (progress === null) return;
      if (progress.resource === "Container" && (progress.state === "Started" || progress.state === "Running")) {
        started.add(progress.name);
      }
      composeStep.update({ latest: line, containersStarted: started.size } satisfies ComposeProgress);
    },
  });

  if (result.code !== 0) {
    composeStep.end({ failed: true, stderr: result.stderr.trim().split("\n").slice(-5) });
    throw new DockerError(result.stderr.trim() || `docker compose up failed (run ${runId})`, result.stderr);
  }
  composeStep.end({ containersStarted: started.size });

  const containers = services.map((n) => containerName(config, runId, n));
  const readyStep = store.beginStep("wait_ready", { containers });
  try {
    await waitForReady(containers, config, (progress) => readyStep.update(progress));
    readyStep.end();
  } catch (error) {
    readyStep.end({ error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/** The chain comes up first: the FNN configs need hashes that only exist once its genesis does. */
async function startChain(run: RunContext, project: ComposeProject): Promise<{ chain: CkbChain; genesis: GenesisFacts }> {
  const { store, config, runId } = run;
  await startServices(run, project, [CKB_SERVICE]);

  const container = containerName(config, runId, CKB_SERVICE);
  const endpoint = await hostEndpoint(container, CKB_RPC_PORT);
  if (endpoint === null) throw new DockerError(`The CKB RPC port is not mapped (${container})`);
  const record = store.data.nodes.find((n) => n.name === CKB_SERVICE);
  if (record) record.endpoint = endpoint;

  const step = store.beginStep("chain_ready", { mining: run.scenario.chain.mining });
  try {
    const chain = new CkbChain({ endpoint, blockIntervalMs: config.blockIntervalMs, logger: store.recordRpc });
    const genesis = await chain.genesis();
    const tip = await chain.mine(1);
    await chain.syncIndexer();
    step.end({ genesis: genesis.hash, tip: tip.toString() });
    return { chain, genesis };
  } catch (error) {
    step.end({ error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function bringUp(run: RunContext): Promise<UpResult> {
  const { scenario, config, runId, store, network, composeFile } = run;
  const images = await buildImages(run);
  const project = buildComposeProject(scenario, runId, config, images);

  const { chain, genesis } = await startChain(run, project);

  await generateNodeConfigs(scenario, runId, genesis);
  await startServices(run, project, scenario.nodes);

  const endpoints: Record<string, string> = {};
  for (const node of scenario.nodes) {
    const endpoint = await hostEndpoint(containerName(config, runId, node), FNN_RPC_PORT);
    if (endpoint === null) throw new DockerError(`The RPC port of "${node}" is not mapped`);
    endpoints[node] = endpoint;
    const record = store.data.nodes.find((n) => n.name === node);
    if (record) record.endpoint = endpoint;
  }
  await store.save();

  return {
    runId,
    project: project.name,
    network,
    nodes: scenario.nodes,
    endpoints,
    ckbEndpoint: chain.endpoint,
    composeFile,
    store,
    chain,
    genesis,
  };
}

export async function up(
  scenario: Scenario,
  config: GlobalConfig,
  opts: { keep?: boolean } = {},
): Promise<UpResult> {
  const runId = await uniqueRunId(config);
  const network = networkName(config, runId);
  const nodes: NodeRecord[] = [CKB_SERVICE, ...scenario.nodes].map((name) => ({
    name,
    container: containerName(config, runId, name),
    endpoint: null,
  }));
  const store = RunLogStore.create({
    runId,
    scenario: scenario.name,
    network,
    versions: { fnn: config.fnnVersion, ckb: CKB_VERSION },
    nodes,
  });
  await store.save();

  if (scenario.nodes.length > RECOMMENDED_MAX_NODES) {
    console.error(
      `Warning: scenario "${scenario.name}" runs ${scenario.nodes.length} nodes, above the recommended ${RECOMMENDED_MAX_NODES} — expect slower runs and more memory use.`,
    );
  }

  try {
    return await bringUp({ runId, scenario, config, store, network, composeFile: composeFilePath(runId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.finish("failed", message);
    await store.save();
    if (shouldKeepOnFailure(config, opts.keep)) printKeepGuidance(runId);
    else await teardownRun(runId, config);
    throw new RunFailedError(message, runId);
  }
}

export async function reset(runId: string, config: GlobalConfig): Promise<void> {
  await teardownRun(runId, config);
  if (await fileExists(join(process.cwd(), ".fiber-lab/runs", `${runId}.json`))) {
    await RunLogStore.setStatus(runId, "reset").catch((error) => {
      console.error(`Warning: could not update run-log for ${runId} (${(error as Error).message}). Docker resources were still cleaned up.`);
    });
  }
}

export async function resetAll(config: GlobalConfig): Promise<string[]> {
  const ids = new Set<string>();

  // A run already marked reset has nothing left to clean, and resetting it again would rewrite
  // its finishedAt.
  for (const run of await listRuns()) if (run.status !== "reset") ids.add(run.runId);

  const prefix = `${config.dockerNetworkPrefix}_`;
  const nets = await docker(["network", "ls", "--filter", `name=${prefix}`, "--format", "{{.Name}}"]);
  for (const n of nets.stdout.split(/\s+/).filter(Boolean)) {
    if (n.startsWith(prefix)) ids.add(n.slice(prefix.length));
  }

  for (const id of ids) await reset(id, config);
  return [...ids];
}
