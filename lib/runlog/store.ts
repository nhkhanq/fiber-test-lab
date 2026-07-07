import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { RUNS_DIR } from "../constants";

export const RpcRecordSchema = z.object({
  node: z.string(),
  method: z.string(),
  params: z.unknown(),
  response: z.unknown().nullable().default(null),
  error: z.unknown().nullable().default(null),
  at: z.string(),
});

export const StepRecordSchema = z.object({
  action: z.string(),
  input: z.unknown().nullable().default(null),
  result: z.unknown().nullable().default(null),
  at: z.string(),
});

export const NodeRecordSchema = z.object({
  name: z.string(),
  container: z.string().nullable().default(null),
  endpoint: z.string().nullable().default(null),
});

export const RunStatusSchema = z.enum(["running", "completed", "failed", "reset"]);

export const RunLogSchema = z.object({
  runId: z.string(),
  scenario: z.string(),
  status: RunStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable().default(null),
  network: z.string(),
  nodes: z.array(NodeRecordSchema).default([]),
  steps: z.array(StepRecordSchema).default([]),
  rpcCalls: z.array(RpcRecordSchema).default([]),
  error: z.string().nullable().default(null),
});

export type RunLog = z.infer<typeof RunLogSchema>;
export type RpcRecord = z.infer<typeof RpcRecordSchema>;
export type StepRecord = z.infer<typeof StepRecordSchema>;
export type NodeRecord = z.infer<typeof NodeRecordSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;

/** Đường dẫn file run-log của 1 run-id. */
export function runLogPath(runId: string): string {
  return join(RUNS_DIR, `${runId}.json`);
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}

export class RunLogStore {
  #log: RunLog;

  private constructor(log: RunLog) {
    this.#log = log;
  }

  static create(params: {
    runId: string;
    scenario: string;
    network: string;
    nodes?: NodeRecord[];
  }): RunLogStore {
    return new RunLogStore(
      RunLogSchema.parse({
        runId: params.runId,
        scenario: params.scenario,
        network: params.network,
        status: "running",
        startedAt: new Date().toISOString(),
        nodes: params.nodes ?? [],
      }),
    );
  }

  get data(): RunLog {
    return this.#log;
  }

  recordRpc = (record: {
    node: string;
    method: string;
    params: unknown;
    response?: unknown;
    error?: unknown;
    at: string;
  }): void => {
    this.#log.rpcCalls.push({
      node: record.node,
      method: record.method,
      params: record.params ?? null,
      response: record.response ?? null,
      error: record.error === undefined ? null : serializeError(record.error),
      at: record.at,
    });
  };

  recordStep(action: string, input: unknown = null, result: unknown = null): void {
    this.#log.steps.push({ action, input, result, at: new Date().toISOString() });
  }

  addNode(node: NodeRecord): void {
    this.#log.nodes.push(node);
  }

  finish(status: RunStatus, error?: string): void {
    this.#log.status = status;
    this.#log.finishedAt = new Date().toISOString();
    if (error !== undefined) this.#log.error = error;
  }

  async save(): Promise<string> {
    const path = runLogPath(this.#log.runId);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(this.#log, null, 2), "utf8");
    return path;
  }

  static async load(runId: string): Promise<RunLog> {
    const raw = await readFile(runLogPath(runId), "utf8");
    return RunLogSchema.parse(JSON.parse(raw));
  }

  /** Nạp lại run-log đã lưu (VD sau `orchestrator.up`) thành store còn ghi tiếp được — dùng cho seed nối tiếp up. */
  static async resume(runId: string): Promise<RunLogStore> {
    return new RunLogStore(await RunLogStore.load(runId));
  }

  /** Cập nhật status của 1 run-log đã lưu (VD "reset") mà KHÔNG xoá file — xem BR-CLN-002. */
  static async setStatus(runId: string, status: RunStatus, error?: string): Promise<void> {
    const log = await RunLogStore.load(runId);
    log.status = status;
    log.finishedAt = new Date().toISOString();
    if (error !== undefined) log.error = error;
    await writeFile(runLogPath(runId), JSON.stringify(RunLogSchema.parse(log), null, 2), "utf8");
  }
}

/** Mọi run-log hiện có (mới nhất trước), dùng cho `fiber-lab list`. Run-log hỏng → bỏ qua, không crash. */
export async function listRuns(): Promise<RunLog[]> {
  const files = await readdir(RUNS_DIR).catch(() => [] as string[]);
  const runs: RunLog[] = [];
  for (const file of files.filter((f) => f.endsWith(".json")).sort()) {
    try {
      runs.push(RunLogSchema.parse(JSON.parse(await readFile(join(RUNS_DIR, file), "utf8"))));
    } catch {
      continue;
    }
  }
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
