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
  durationMs: z.number().optional(),
});

/** One node's view of one channel, as of a step. Balances are decimal strings in base units
 *  (shannon for CKB) — FNN returns hex and UDT amounts can exceed Number.MAX_SAFE_INTEGER. */
export const ChannelSnapshotSchema = z.object({
  node: z.string(),
  peer: z.string().nullable().default(null),
  channelId: z.string(),
  state: z.string(),
  asset: z.string().default("CKB"),
  localBalance: z.string().nullable().default(null),
  remoteBalance: z.string().nullable().default(null),
});

export const StepRecordSchema = z.object({
  action: z.string(),
  input: z.unknown().nullable().default(null),
  result: z.unknown().nullable().default(null),
  at: z.string(),
  channels: z.array(ChannelSnapshotSchema).optional(),
  /** Set by beginStep/endStep for work long enough to watch (image builds, waiting for READY,
   *  opening a channel). Absent on a step recorded in one shot, and on every pre-2026-09-22
   *  run-log, both of which are complete by definition. */
  status: z.enum(["running", "done"]).optional(),
  endedAt: z.string().optional(),
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
export type ChannelSnapshot = z.infer<typeof ChannelSnapshotSchema>;
export type NodeRecord = z.infer<typeof NodeRecordSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;

export function runLogPath(runId: string): string {
  return join(RUNS_DIR, `${runId}.json`);
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}

/** A step that is still running. `update` publishes progress while it runs — the run viewer
 *  polls the run-log, so anything not written to disk is invisible until the run ends. */
export interface StepHandle {
  update(result: unknown): void;
  end(result?: unknown, channels?: ChannelSnapshot[]): void;
}

const FLUSH_INTERVAL_MS = 200;

export class RunLogStore {
  #log: RunLog;
  /** Writes are coalesced: docker streams progress far faster than the disk needs to see it,
   *  and the viewer polls on its own clock anyway. */
  #flushTimer: NodeJS.Timeout | null = null;
  #writing: Promise<void> | null = null;
  #dirty = false;

  private constructor(log: RunLog) {
    this.#log = log;
  }

  /** Schedule a write. Callers never await this: a run-log write must not pace the run. */
  #touch(): void {
    this.#dirty = true;
    if (this.#flushTimer !== null) return;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      void this.save();
    }, FLUSH_INTERVAL_MS);
    // Never hold the process open for a pending run-log write.
    this.#flushTimer.unref?.();
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
    durationMs?: number;
  }): void => {
    this.#log.rpcCalls.push({
      node: record.node,
      method: record.method,
      params: record.params ?? null,
      response: record.response ?? null,
      error: record.error === undefined ? null : serializeError(record.error),
      at: record.at,
      ...(record.durationMs === undefined ? {} : { durationMs: record.durationMs }),
    });
    this.#touch();
  };

  recordStep(
    action: string,
    input: unknown = null,
    result: unknown = null,
    channels?: ChannelSnapshot[],
  ): void {
    this.#log.steps.push({
      action,
      input,
      result,
      at: new Date().toISOString(),
      ...(channels === undefined ? {} : { channels }),
    });
    this.#touch();
  }

  /** Record a step that has started but not finished, so the viewer can show it in flight. */
  beginStep(action: string, input: unknown = null): StepHandle {
    const step: StepRecord = {
      action,
      input,
      result: null,
      at: new Date().toISOString(),
      status: "running",
    };
    this.#log.steps.push(step);
    this.#touch();

    return {
      update: (result: unknown) => {
        if (step.status !== "running") return;
        step.result = result;
        this.#touch();
      },
      end: (result?: unknown, channels?: ChannelSnapshot[]) => {
        if (result !== undefined) step.result = result;
        if (channels !== undefined) step.channels = channels;
        step.status = "done";
        step.endedAt = new Date().toISOString();
        this.#touch();
      },
    };
  }

  addNode(node: NodeRecord): void {
    this.#log.nodes.push(node);
    this.#touch();
  }

  /** Any step still marked running when the run ends died with it. */
  finish(status: RunStatus, error?: string): void {
    const endedAt = new Date().toISOString();
    for (const step of this.#log.steps) {
      if (step.status === "running") {
        step.status = "done";
        step.endedAt = endedAt;
      }
    }
    this.#log.status = status;
    this.#log.finishedAt = endedAt;
    if (error !== undefined) this.#log.error = error;
    this.#touch();
  }

  async save(): Promise<string> {
    const path = runLogPath(this.#log.runId);
    // One write at a time; a write that lands mid-flight just re-runs afterwards.
    if (this.#writing !== null) {
      this.#dirty = true;
      await this.#writing;
      if (!this.#dirty) return path;
    }

    this.#dirty = false;
    this.#writing = (async () => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(this.#log, null, 2), "utf8");
    })();
    try {
      await this.#writing;
    } finally {
      this.#writing = null;
    }
    if (this.#dirty) return this.save();
    return path;
  }

  static async load(runId: string): Promise<RunLog> {
    const raw = await readFile(runLogPath(runId), "utf8");
    return RunLogSchema.parse(JSON.parse(raw));
  }

  static async resume(runId: string): Promise<RunLogStore> {
    return new RunLogStore(await RunLogStore.load(runId));
  }

  static async setStatus(runId: string, status: RunStatus, error?: string): Promise<void> {
    const log = await RunLogStore.load(runId);
    log.status = status;
    log.finishedAt = new Date().toISOString();
    if (error !== undefined) log.error = error;
    await writeFile(runLogPath(runId), JSON.stringify(RunLogSchema.parse(log), null, 2), "utf8");
  }
}

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

/** The scenario's most recent live (non-reset) run — used by `fiber-lab seed` when `--run` is omitted. */
export async function latestRunForScenario(scenario: string): Promise<RunLog | null> {
  const runs = await listRuns();
  return runs.find((r) => r.scenario === scenario && r.status !== "reset") ?? null;
}
