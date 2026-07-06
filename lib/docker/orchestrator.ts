import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { GlobalConfig } from "../config";
import { CKB_SERVICE, WORK_DIR } from "../constants";
import { RunLogStore, type NodeRecord } from "../runlog/store";
import type { Scenario } from "../scenario/schema";
import {
  buildComposeProject,
  containerName,
  networkName,
  renderComposeYaml,
  type ComposeProject,
} from "../../topology/compose.template";

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

function docker(args: string[]): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { cwd: process.cwd() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/** run-id: lowercase alnum, an toàn cho tên network/container/project của docker. */
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

/** Sinh run-id chưa trùng network/run-log đang tồn tại (BR-ISO-004). */
async function uniqueRunId(config: GlobalConfig): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const id = newRunId();
    if (!(await networkExists(networkName(config, id))) && !(await fileExists(join(WORK_DIR, `${id}.yml`)))) {
      return id;
    }
  }
  throw new Error("Không sinh được run-id duy nhất sau 5 lần thử");
}

/**
 * Dọn sạch mọi tài nguyên docker của 1 project (BR-CLN-001/002). Idempotent —
 * gọi trên run không tồn tại là no-op. Bọc lỗi để luôn cố dọn hết các bước sau.
 */
export async function teardown(project: string, network: string, composeFile?: string): Promise<void> {
  const downArgs = ["compose", "-p", project];
  if (composeFile && (await fileExists(composeFile))) downArgs.push("-f", composeFile);
  downArgs.push("down", "-v", "--remove-orphans", "--timeout", "10");
  await docker(downArgs);

  // Fallback: ép xoá container còn sót theo nhãn compose project (kể cả khi up lỗi giữa chừng).
  const ps = await docker(["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`]);
  const ids = ps.stdout.split(/\s+/).filter(Boolean);
  if (ids.length) await docker(["rm", "-f", ...ids]);

  if (await networkExists(network)) await docker(["network", "rm", network]);
}

/** Ghi compose YAML ra file work rồi `docker compose up -d`. Seam chung cho `up()` và test. */
export async function composeUp(params: {
  project: string;
  composeFile: string;
  composeYaml: string;
  build?: boolean;
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
  return docker(args);
}

export interface UpResult {
  runId: string;
  project: string;
  network: string;
  nodes: string[];
  composeFile: string;
}

/**
 * Dựng topology cho scenario: sinh run-id + compose động → `docker compose up -d --build`.
 * Lỗi giữa chừng → tự teardown (trừ khi keep). KHÔNG chờ node READY (đó là E3-5).
 */
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

  const result = await composeUp({
    project: project.name,
    composeFile,
    composeYaml: renderComposeYaml(project),
    build: true,
  });

  if (result.code !== 0) {
    store.finish("failed", result.stderr.trim() || `docker compose up exit ${result.code}`);
    await store.save();
    if (!opts.keep) await teardown(project.name, network, composeFile);
    throw new DockerError(`docker compose up thất bại (run ${runId})`, result.stderr);
  }

  return {
    runId,
    project: project.name,
    network,
    nodes: scenario.nodes.filter((n) => n !== CKB_SERVICE),
    composeFile,
  };
}

/** Reset 1 run: teardown docker + đánh dấu run-log `status: reset` (giữ file). */
export async function reset(runId: string, config: GlobalConfig): Promise<void> {
  const network = networkName(config, runId);
  await teardown(network, network, composeFilePath(runId)); // project name == network
  if (await fileExists(join(process.cwd(), ".fiber-lab/runs", `${runId}.json`))) {
    await RunLogStore.setStatus(runId, "reset");
  }
  await rm(composeFilePath(runId), { force: true });
}

/** Reset tất cả run: gộp run-id từ run-log + network `<prefix>_*` còn sót. */
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
