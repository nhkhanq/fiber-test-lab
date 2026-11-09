import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { PACKAGE_ROOT } from "../lib/constants";

const run = promisify(execFile);
const TIMEOUT_MS = 300_000;
const CKB = (n: number) => `0x${(BigInt(n) * 100_000_000n).toString(16)}`;

async function lab(...args: string[]): Promise<string> {
  const { stdout } = await run(process.execPath, [join(PACKAGE_ROOT, "bin/fiber-lab.mjs"), ...args], {
    cwd: PACKAGE_ROOT,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

async function rpc(url: string, method: string, ...params: unknown[]): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForStatus(url: string, hash: string, want: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  let status = "";
  while (Date.now() < deadline) {
    status = (await rpc(url, "get_payment", { payment_hash: hash })).status;
    if (status === want) return status;
    await sleep(500);
  }
  return status;
}

describe("driving a run from outside, through the CLI alone", () => {
  it(
    "starts an environment and forces states on it",
    async () => {
      const up = JSON.parse(await lab("up", join("test", "fixtures", "three-nodes.yaml"), "--json"));
      const runId: string = up.runId;
      try {
        const environment = up.environment;
        const alice = environment.nodes.alice.rpc as string;
        const charlieKey = environment.nodes.charlie.pubkey as string;
        expect(environment.ckb.genesis.secp256k1DepGroup.txHash).toMatch(/^0x/);
        expect(environment.nodes.alice.privateKey).toMatch(/^0x/);

        // The first thing an outside client does, the moment `up` returns: a route over two hops.
        const first = await rpc(alice, "send_payment", { target_pubkey: charlieKey, amount: CKB(1), keysend: true });
        expect(await waitForStatus(alice, first.payment_hash, "Success")).toBe("Success");

        expect(JSON.parse(await lab("env", "--json")).runId).toBe(runId);
        expect(await lab("env", runId, "--dotenv")).toContain(`FIBER_LAB_NODE_ALICE_RPC=${alice}`);

        const tip = BigInt(JSON.parse(await lab("chain", "tip", "--run", runId, "--json")).tip);
        expect(BigInt(JSON.parse(await lab("chain", "mine", "3", "--run", runId, "--json")).tip)).toBe(tip + 3n);

        await lab("node", "pause", "charlie", "--run", runId);
        const held = await rpc(alice, "send_payment", { target_pubkey: charlieKey, amount: CKB(1), keysend: true });
        await sleep(3000);
        expect((await rpc(alice, "get_payment", { payment_hash: held.payment_hash })).status).toBe("Inflight");

        // A separate process must see the pause recorded by the last one, or this would hang on the frozen node.
        const started = Date.now();
        await lab("chain", "mine", "1", "--run", runId);
        expect(Date.now() - started).toBeLessThan(20_000);

        await lab("node", "resume", "charlie", "--run", runId);
        expect(await waitForStatus(alice, held.payment_hash, "Success")).toBe("Success");

        await lab("node", "kill", "bob", "--run", runId);
        await lab("node", "start", "bob", "--run", runId);
        const afterRestart = JSON.parse(await lab("env", runId, "--json"));
        expect((await rpc(afterRestart.nodes.bob.rpc, "node_info")).node_name).toBe("bob");

        await lab("peer", "disconnect", "alice", "bob", "--run", runId);
        expect((await rpc(alice, "list_peers")).peers).toEqual([]);
        await lab("peer", "connect", "alice", "bob", "--run", runId);
        expect((await rpc(alice, "list_peers")).peers).toHaveLength(1);

        const opened = JSON.parse(await lab("channel", "open", "charlie", "alice", "300", "--run", runId, "--json"));
        expect(opened.channelId).toMatch(/^0x/);
        const closed = JSON.parse(await lab("channel", "close", "charlie", "alice", "--run", runId, "--json"));
        expect(closed).toMatchObject({ channelId: opened.channelId, flags: "COOPERATIVE" });

        const failure = await lab("channel", "close", "charlie", "alice", "--run", runId).catch((e: { code: number; stderr: string }) => e);
        expect(failure).toMatchObject({ code: 2, stderr: expect.stringContaining("no open channel") });
      } finally {
        await lab("reset", runId);
      }
    },
    TIMEOUT_MS,
  );

  it("reports bad usage as a validation error, before touching Docker", async () => {
    await expect(lab("node", "explode", "bob")).rejects.toMatchObject({ code: 1 });
    await expect(lab("chain", "tip", "--run", "no-such-run")).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("not found") });
    await expect(lab("chain", "mine", "lots", "--run", "no-such-run")).rejects.toMatchObject({ code: 1 });
  }, 60_000);

  it("refuses to treat an environment as a test that passed", async () => {
    const failure = await lab("test", join("test", "fixtures", "three-nodes.yaml"), "--json").catch((e: { code: number; stdout: string }) => e);
    expect(failure).toMatchObject({ code: 3 });
    const report = JSON.parse((failure as { stdout: string }).stdout);
    expect(report.cases[0]).toMatchObject({ status: "failed", messages: ["nothing was checked"] });
  }, TIMEOUT_MS);
});
