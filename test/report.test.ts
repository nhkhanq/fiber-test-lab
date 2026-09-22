import { describe, expect, it } from "vitest";
import { buildReportModel, formatAmount } from "../lib/report/model";
import { renderReport, renderRunList } from "../lib/report/render";
import { startUiServer } from "../lib/report/server";
import { RunLogSchema, RunLogStore, type RunLog } from "../lib/runlog/store";

/** Unit tests: no Docker, no RPC. The run viewer is a pure function of a run-log. */

const channelId = "0xc0ffee";

function runLog(overrides: Partial<RunLog> = {}): RunLog {
  return RunLogSchema.parse({
    runId: "test-run",
    scenario: "two-hop-route",
    status: "completed",
    startedAt: "2026-09-22T10:00:00.000Z",
    finishedAt: "2026-09-22T10:00:30.000Z",
    network: "flab_test-run",
    nodes: [
      { name: "ckb", container: "flab_test-run_ckb", endpoint: null },
      { name: "alice", container: "flab_test-run_alice", endpoint: "http://127.0.0.1:1" },
      { name: "bob", container: "flab_test-run_bob", endpoint: "http://127.0.0.1:2" },
    ],
    steps: [
      {
        action: "open_channel",
        input: { from: "alice", to: "bob", capacity: 500, asset: "CKB" },
        result: { ready: true },
        at: "2026-09-22T10:00:05.000Z",
        channels: [
          {
            node: "alice",
            peer: "bob",
            channelId,
            state: "ChannelReady",
            asset: "CKB",
            localBalance: "40000000000",
            remoteBalance: "10000000000",
          },
          {
            node: "bob",
            peer: "alice",
            channelId,
            state: "ChannelReady",
            asset: "CKB",
            localBalance: "10000000000",
            remoteBalance: "40000000000",
          },
        ],
      },
      {
        action: "send_payment",
        input: { from: "alice", to: "bob", amount: 100, asset: "CKB" },
        result: { status: "Success" },
        at: "2026-09-22T10:00:20.000Z",
      },
    ],
    rpcCalls: [
      {
        node: "alice",
        method: "node_info",
        params: [],
        response: { version: "0.8.0" },
        at: "2026-09-22T10:00:01.000Z",
        durationMs: 12,
      },
      {
        node: "alice",
        method: "send_payment",
        params: [{ amount: "0x1" }],
        error: { message: "insufficient" },
        at: "2026-09-22T10:00:20.000Z",
        durationMs: 340,
      },
    ],
    ...overrides,
  });
}

describe("buildReportModel", () => {
  it("pairs the two per-node views of a channel into one edge", () => {
    const model = buildReportModel(runLog());
    expect(model.edges).toHaveLength(1);
    expect(model.edges[0]).toMatchObject({
      a: "alice",
      b: "bob",
      aBalance: "40000000000",
      bBalance: "10000000000",
      state: "ChannelReady",
      onPaymentPath: true,
    });
  });

  it("keeps the chain node out of the topology but in the node list", () => {
    const model = buildReportModel(runLog());
    expect(model.nodes.find((n) => n.name === "ckb")?.isChain).toBe(true);
    expect(renderReport(model)).not.toContain(">ckb</text>");
  });

  it("reads the verdict off the expect step", () => {
    const log = runLog();
    log.steps.push({
      action: "expect",
      input: { status: "succeeded" },
      result: { match: false, expected: "succeeded", actual: "failed" },
      at: "2026-09-22T10:00:25.000Z",
    });
    const model = buildReportModel(log);
    expect(model.summary.verdict).toBe("mismatch");
    expect(model.steps.at(-1)!.ok).toBe(false);
  });

  it("does not charge a reset run's idle hours to its last step", () => {
    const model = buildReportModel(
      runLog({ status: "reset", finishedAt: "2026-09-22T16:00:00.000Z" }),
    );
    expect(model.steps.at(-1)!.durationMs).toBeNull();
    expect(model.summary.activeMs).toBe(20_000);
    expect(model.summary.durationMs).toBe(21_600_000);
  });

  it("flags failed RPC calls and surfaces the error message", () => {
    const model = buildReportModel(runLog());
    const failed = model.rpcCalls.filter((c) => !c.ok);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.errorMessage).toBe("insufficient");
    expect(model.slowestRpcMs).toBe(340);
  });

  it("still builds from a run-log written before the channels/durationMs fields existed", () => {
    const log = runLog();
    for (const step of log.steps) delete step.channels;
    for (const call of log.rpcCalls) delete call.durationMs;
    const model = buildReportModel(log);
    expect(model.edges).toEqual([]);
    expect(model.slowestRpcMs).toBeNull();
    expect(renderReport(model)).toContain("No channel snapshot");
  });
});

describe("running steps", () => {
  it("marks a step that has begun but not ended, and surfaces its progress", () => {
    const log = runLog({ status: "running", finishedAt: null });
    log.steps.push({
      action: "docker_up",
      input: { services: ["ckb", "alice", "bob"] },
      result: { latest: "Container flab_x_ckb Started", imagesBuilt: 2, containersStarted: 1 },
      at: new Date(Date.now() - 4000).toISOString(),
      status: "running",
    });
    const step = buildReportModel(log).steps.at(-1)!;
    expect(step.running).toBe(true);
    expect(step.progress).toBe("Container flab_x_ckb Started");
    // A running step's bar has to grow from its start to now, not sit at zero.
    expect(step.durationMs).toBeGreaterThan(3000);
  });

  it("reports health progress while waiting for READY", () => {
    const log = runLog({ status: "running", finishedAt: null });
    log.steps.push({
      action: "wait_ready",
      input: { containers: ["a", "b", "c", "d"] },
      result: { ready: ["a", "b"], pending: ["c", "d"] },
      at: new Date().toISOString(),
      status: "running",
    });
    expect(buildReportModel(log).steps.at(-1)!.summary).toBe("2/4 healthy");
  });

  it("changes the fingerprint when only a running step's progress moves", () => {
    const base = runLog({ status: "running", finishedAt: null });
    base.steps.push({
      action: "docker_up",
      input: { services: ["ckb"] },
      result: { latest: "Image flab_x-ckb Building" },
      at: "2026-09-22T10:00:25.000Z",
      status: "running",
    });
    const before = buildReportModel(base).fingerprint;

    (base.steps.at(-1)!.result as Record<string, unknown>).latest = "Container flab_x_ckb Started";
    expect(buildReportModel(base).fingerprint).not.toBe(before);
  });

  it("closes any step left running when the run ends", async () => {
    const store = RunLogStore.create({ runId: "finish-test", scenario: "s", network: "n" });
    const handle = store.beginStep("docker_up");
    handle.update({ latest: "Image Building" });
    store.finish("failed", "boom");
    expect(store.data.steps[0]!.status).toBe("done");
    expect(store.data.steps[0]!.endedAt).toBeTypeOf("string");
    expect(buildReportModel(store.data).steps[0]!.running).toBe(false);
  });
});

describe("formatAmount", () => {
  it("renders shannon as CKB and leaves UDT amounts in their own unit", () => {
    expect(formatAmount("40000000000", "CKB")).toBe("400 CKB");
    expect(formatAmount("40000000001", "CKB")).toBe("400.00000001 CKB");
    expect(formatAmount("42", "RUSD")).toBe("42 RUSD");
    expect(formatAmount(null, "CKB")).toBe("—");
  });
});

describe("renderReport", () => {
  it("produces one self-contained document with no external references", () => {
    const html = renderReport(buildReportModel(runLog()));
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)="(https?:)?\/\//);
    expect(html).toContain("<svg");
  });

  it("escapes run-log content instead of injecting it as markup", () => {
    const log = runLog({ scenario: "<img src=x onerror=alert(1)>" });
    const html = renderReport(buildReportModel(log));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("closes no <script> early when a run-log contains one", () => {
    const log = runLog();
    log.error = "</script><script>alert(1)</script>";
    const html = renderReport(buildReportModel(log));

    const payload = /<script id="run-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]!;
    // The payload must carry no raw `</script`, or the browser would end the block here.
    expect(payload).not.toContain("</script");
    // …and it must still be the real model: escaping, not stripping.
    expect(JSON.parse(payload).summary.error).toBe(log.error);
  });

  it("only injects the polling script when served live", () => {
    const model = buildReportModel(runLog());
    expect(renderReport(model)).not.toContain("location.reload()");
    expect(renderReport(model, { live: true })).toContain("location.reload()");
  });
});

describe("topology rendering", () => {
  it("gives every node its own colour and paints each balance in its holder's colour", () => {
    const html = renderReport(buildReportModel(runLog()));
    // One CSS variable per node, and the edge segments reference them rather than raw hex.
    expect(html).toContain("--node-alice:");
    expect(html).toContain("--node-bob:");
    expect(html).toContain('stroke="var(--node-alice, var(--muted))"');
    expect(html).toContain('stroke="var(--node-bob, var(--muted))"');
  });

  it("defines dark-mode colours under both the media query and the theme scope", () => {
    const html = renderReport(buildReportModel(runLog()));
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).toContain(':root[data-theme="dark"]');
    // The dark steps are chosen for the dark surface, not an automatic flip of the light ones.
    expect(html).toContain("#3987e5");
    expect(html).toContain("#2a78d6");
  });

  it("builds one scrubber frame per snapshot and hides the scrubber when there is nothing to scrub", () => {
    const single = renderReport(buildReportModel(runLog()));
    expect(single).not.toContain('id="frame-range"');

    const log = runLog();
    const second = structuredClone(log.steps[0]!);
    second.at = "2026-09-22T10:00:22.000Z";
    second.channels![0]!.localBalance = "39000000000";
    log.steps.push(second);

    const model = buildReportModel(log);
    expect(model.steps.filter((s) => s.edges.length > 0)).toHaveLength(2);
    const html = renderReport(model);
    expect(html).toContain('id="frame-range"');
    expect(html).toContain('max="1"');
  });

  it("animates the flow only along the payment path", () => {
    const html = renderReport(buildReportModel(runLog()));
    const edges = html.slice(html.indexOf('id="graph-edges"'), html.indexOf("</svg>"));
    // One edge, and it is on the path, so exactly one packet.
    expect(edges.match(/animateMotion/g)).toHaveLength(1);
  });
});

describe("ui server", () => {
  it("binds loopback only and serves the run list, a report and its JSON", async () => {
    const server = await startUiServer();
    try {
      expect(server.url).toContain("127.0.0.1");

      const index = await fetch(server.url);
      expect(index.status).toBe(200);
      expect(index.headers.get("content-type")).toContain("text/html");

      const missing = await fetch(`${server.url}run/does-not-exist`);
      expect(missing.status).toBe(404);
    } finally {
      await server.close();
    }
  });
});

describe("renderRunList", () => {
  it("tells the reader what to do when there are no runs yet", () => {
    expect(renderRunList([])).toContain("fiber-lab up");
  });
});
