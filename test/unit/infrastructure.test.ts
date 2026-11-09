import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseToml } from "./toml";
import { CkbChain, parseGenesis } from "../../lib/ckb/chain";
import { GlobalConfigSchema } from "../../lib/config";
import { DEV_FUNDED_KEYS, GENESIS_SIMPLE_UDT_INDEX, PACKAGE_ROOT } from "../../lib/constants";
import { buildFailureCause, contextDigest, imageTags, isLabImage } from "../../lib/docker/images";
import { FiberClient } from "../../lib/fiber/client";
import { jsonRpcCall, type RpcCallRecord } from "../../lib/fiber/jsonRpc";
import { nodeConfigYaml } from "../../lib/fiber/nodeConfig";
import { parseScenario } from "../../lib/scenario/loader";
import { renderJUnit, suiteExitCode, type SuiteResult } from "../../lib/scenario/suite";
import { buildComposeProject } from "../../topology/compose.template";

type Handler = (method: string, params: unknown[]) => unknown;

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function rpcServer(handler: Handler): Promise<string> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const { method, params, id } = JSON.parse(body) as { method: string; params: unknown[]; id: number };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result: handler(method, params) }));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function silentServer(): Promise<string> {
  const server = createServer(() => {});
  servers.push(server);
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("json-rpc", () => {
  it("logs a call that succeeds", async () => {
    const records: RpcCallRecord[] = [];
    const endpoint = await rpcServer(() => "0x1");
    await jsonRpcCall({ node: "ckb", endpoint, method: "m", params: [], timeoutMs: 1000, logger: (r) => records.push(r) });
    expect(records[0]).toMatchObject({ node: "ckb", method: "m", response: "0x1" });
  });

  it("times out on a node that accepts the connection and then says nothing", async () => {
    const records: RpcCallRecord[] = [];
    const endpoint = await silentServer();
    const client = new FiberClient({ endpoints: { alice: endpoint }, timeoutMs: 100, logger: (r) => records.push(r) });
    await expect(client.rawCall("alice", "node_info")).rejects.toThrow(/timed out after 100ms/);
    expect(records).toHaveLength(1);
    expect(records[0]?.error).toBeDefined();
    for (const server of servers) server.closeAllConnections?.();
  });
});

describe("CkbChain", () => {
  function fakeChain() {
    let tip = 0;
    let indexed = 0;
    const calls: string[] = [];
    const handler: Handler = (method) => {
      calls.push(method);
      switch (method) {
        case "generate_block":
          tip += 1;
          return "0xhash";
        case "generate_epochs":
          tip += 20;
          return "0x2";
        case "get_tip_block_number":
          return `0x${tip.toString(16)}`;
        case "get_indexer_tip":
          indexed = Math.min(tip, indexed + 5);
          return { block_number: `0x${indexed.toString(16)}` };
        case "get_cells_capacity":
          return { capacity: "0x64" };
        default:
          throw new Error(`unexpected ${method}`);
      }
    };
    return { handler, calls, tip: () => tip };
  }

  const options = { blockIntervalMs: 1 };

  it("mines the requested number of blocks and reports the tip", async () => {
    const fake = fakeChain();
    const chain = new CkbChain({ endpoint: await rpcServer(fake.handler), ...options });
    expect(await chain.mine(3)).toBe(3n);
    expect(fake.calls.filter((c) => c === "generate_block")).toHaveLength(3);
  });

  it("does not move the chain unless asked", async () => {
    const fake = fakeChain();
    const chain = new CkbChain({ endpoint: await rpcServer(fake.handler), ...options });
    await chain.syncIndexer();
    await chain.tip();
    expect(fake.tip()).toBe(0);
  });

  it("keeps mining until the probe holds, then waits for the indexer", async () => {
    const fake = fakeChain();
    const chain = new CkbChain({ endpoint: await rpcServer(fake.handler), ...options });
    const value = await chain.mineUntil(async () => (fake.tip() >= 8 ? "done" : null), {
      label: "x",
      timeoutMs: 5000,
      probeIntervalMs: 1,
    });
    expect(value).toBe("done");
    expect(fake.tip()).toBeGreaterThanOrEqual(8);
    expect(fake.calls.at(-1)).toBe("get_indexer_tip");
  });

  it("gives up with the label in the message", async () => {
    const fake = fakeChain();
    const chain = new CkbChain({ endpoint: await rpcServer(fake.handler), ...options });
    await expect(
      chain.mineUntil(async () => null, { label: "the channel", timeoutMs: 20, probeIntervalMs: 1 }),
    ).rejects.toThrow(/waiting for the channel/);
  });

  it("sends the epoch count as hex", async () => {
    const seen: unknown[][] = [];
    const fake = fakeChain();
    const endpoint = await rpcServer((method, params) => {
      if (method === "generate_epochs") seen.push(params);
      return fake.handler(method, params);
    });
    await new CkbChain({ endpoint, ...options }).advanceEpochs(10);
    expect(seen).toEqual([["0xa"]]);
  });

  it("reports capacity in shannon", async () => {
    const chain = new CkbChain({ endpoint: await rpcServer(fakeChain().handler), ...options });
    expect(await chain.capacityOf({ code_hash: "0x", hash_type: "type", args: "0x" })).toBe(100n);
  });
});

describe("genesis", () => {
  const specPath = join(PACKAGE_ROOT, "topology/docker/ckb/dev.toml");

  it("funds one account for every key the lab can hand a node", async () => {
    const spec = parseToml(await readFile(specPath, "utf8"));
    const issued = spec.issuedArgs;
    const client = new ccc.ClientPublicTestnet();
    for (const key of DEV_FUNDED_KEYS) {
      const { publicKey } = new ccc.SignerCkbPrivateKey(client, `0x${key}`);
      expect(issued).toContain(ccc.hashCkb(publicKey).slice(0, 42));
    }
  });

  it("keeps simple_udt where the lab looks for it", async () => {
    const spec = parseToml(await readFile(specPath, "utf8"));
    // Output 0 of the cellbase is the genesis message cell, so system cell N is output N.
    expect(spec.systemCells[GENESIS_SIMPLE_UDT_INDEX - 1]).toBe("/fiber-scripts/simple_udt");
  });

  it("derives the cells the lab needs from block 0", () => {
    const outputsData = Array.from({ length: 12 }, () => "0x00");
    outputsData[GENESIS_SIMPLE_UDT_INDEX] = "0xc0de";
    const facts = parseGenesis({
      header: { hash: "0xgenesis" },
      transactions: [
        { hash: "0xcellbase", outputs_data: outputsData },
        { hash: "0xdepgroups", outputs_data: [] },
      ],
    });
    expect(facts).toEqual({
      hash: "0xgenesis",
      simpleUdt: { codeHash: ccc.hashCkb("0xc0de"), txHash: "0xcellbase", index: GENESIS_SIMPLE_UDT_INDEX },
      secp256k1DepGroup: { txHash: "0xdepgroups", index: 0 },
    });
  });

  it("refuses a block that does not look like this devnet's genesis", () => {
    expect(() => parseGenesis({ header: { hash: "0x" }, transactions: [] })).toThrow(/Genesis block/);
  });

  it("puts the derived UDT cell in each node's config", () => {
    const yaml = nodeConfigYaml("alice", {
      hash: "0x",
      simpleUdt: { codeHash: "0xcode", txHash: "0xtx", index: 8 },
      secp256k1DepGroup: { txHash: "0x", index: 0 },
    });
    expect(yaml).toContain("code_hash: 0xcode");
    expect(yaml).toContain("tx_hash: 0xtx");
    expect(yaml).toContain('index: "0x8"');
  });
});

describe("images and compose", () => {
  const config = GlobalConfigSchema.parse({ fnnVersion: "0.9.1" });
  const images = imageTags("0.9.1", "abc");
  const scenario = (mining?: "auto" | "manual") =>
    parseScenario({
      name: "t",
      nodes: ["alice", "bob"],
      seed: [{ action: "send_payment", from: "alice", to: "bob", amount: 1 }],
      expect: { status: "succeeded" },
      ...(mining === undefined ? {} : { chain: { mining } }),
    });

  it("names images after the versions they contain", () => {
    expect(images.fnn).toBe("flab-fnn:0.9.1-abc");
    expect(images.ckb).toContain("fnn0.9.1");
  });

  it("recognises the lab's images and nobody else's", () => {
    expect(isLabImage("flab-fnn:0.9.1-abc", "flab")).toBe(true);
    expect(isLabImage("flab-ckb:0.207.0-fnn0.9.1-abc", "flab")).toBe(true);
    expect(isLabImage("flab_mw8nyzoid49873-alice:latest", "flab")).toBe(true);
    expect(isLabImage("redis:7-alpine", "flab")).toBe(false);
    expect(isLabImage("flabbergasted:latest", "flab")).toBe(false);
  });

  it("reports why a build failed, not the Dockerfile it echoes afterwards", () => {
    const output = [
      "#7 [3/6] RUN curl https://example/fnn.tar.gz",
      "#7 ERROR: process did not complete successfully: exit code: 22",
      "------",
      " > [3/6] RUN curl https://example/fnn.tar.gz:",
      "0.318 curl: (22) The requested URL returned error: 504",
      "------",
      "fnn.Dockerfile:12",
      "--------------------",
      "  12 | >>> RUN curl https://example/fnn.tar.gz",
      "--------------------",
      "ERROR: failed to build: failed to solve",
    ].join("\r\n");
    const cause = buildFailureCause(output);
    expect(cause).toContain("curl: (22) The requested URL returned error: 504");
    expect(cause).not.toContain("failed to solve");
  });

  it("falls back to the end of the output when there is no failing step to quote", () => {
    expect(buildFailureCause("one\ntwo\nCannot connect to the Docker daemon")).toContain("Cannot connect");
  });

  it("digests the build context, so a changed file means a new tag", async () => {
    const digest = await contextDigest();
    expect(digest).toMatch(/^[0-9a-f]{12}$/);
    expect(await contextDigest()).toBe(digest);
  });

  it("uses the shared images and never builds per run", () => {
    const project = buildComposeProject(scenario(), "run1", config, images);
    expect(project.services.alice?.image).toBe(images.fnn);
    expect(project.services.ckb?.image).toBe(images.ckb);
    expect(JSON.stringify(project)).not.toContain('"build"');
  });

  it("derives every name from the run-id", () => {
    const a = JSON.stringify(buildComposeProject(scenario(), "run1", config, images));
    const b = JSON.stringify(buildComposeProject(scenario(), "run2", config, images));
    expect(a).toContain("flab_run1_alice");
    expect(b).not.toContain("run1");
  });

  it("publishes ports only on loopback, on ports the OS picks", () => {
    const project = buildComposeProject(scenario(), "run1", config, images);
    for (const service of Object.values(project.services)) {
      for (const port of service.ports ?? []) expect(port).toMatch(/^127\.0\.0\.1::\d+$/);
    }
  });

  it("runs the miner only when a scenario asks for it", () => {
    const mining = (mode?: "auto" | "manual") =>
      buildComposeProject(scenario(mode), "run1", config, images).services.ckb?.environment?.CKB_AUTO_MINE;
    expect(mining()).toBe("false");
    expect(mining("auto")).toBe("true");
  });

  it("runs FNN as the invoking user when told one, so its files stay removable", () => {
    expect(buildComposeProject(scenario(), "r", config, images, "1001:1001").services.alice?.user).toBe("1001:1001");
    expect(buildComposeProject(scenario(), "r", config, images, null).services.alice?.user).toBeUndefined();
  });
});

describe("suite reporting", () => {
  const result: SuiteResult = {
    durationMs: 3000,
    passed: 1,
    failed: 1,
    errors: 1,
    cases: [
      { scenario: "ok", status: "passed", runId: "r1", durationMs: 1000, messages: [] },
      { scenario: "wrong", status: "failed", runId: "r2", durationMs: 1000, messages: [`fee <expected> & "got"`] },
      { scenario: "broken", status: "error", runId: null, durationMs: 1000, messages: ["docker\u0007 failed"] },
    ],
  };

  it("writes JUnit a CI server can read", () => {
    const xml = renderJUnit(result);
    expect(xml).toContain('<testsuites name="fiber-lab" tests="3" failures="1" errors="1" time="3.000">');
    expect(xml).toContain('<testcase classname="fiber-lab" name="ok" time="1.000">');
    expect(xml).toContain("<system-out>run-id: r2</system-out>");
  });

  it("escapes what it cannot print literally", () => {
    const xml = renderJUnit(result);
    expect(xml).toContain("fee &lt;expected&gt; &amp; &quot;got&quot;");
    expect(xml).not.toContain("\u0007");
  });

  it("marks failures and errors differently", () => {
    const xml = renderJUnit(result);
    expect(xml).toMatch(/name="wrong"[\s\S]*?<failure/);
    expect(xml).toMatch(/name="broken"[\s\S]*?<error/);
  });

  it("exits with the code of the worst outcome", () => {
    const counts = (passed: number, failed: number, errors: number): SuiteResult => ({ cases: [], durationMs: 0, passed, failed, errors });
    expect(suiteExitCode(counts(3, 0, 0))).toBe(0);
    expect(suiteExitCode(counts(2, 1, 0))).toBe(3);
    expect(suiteExitCode(counts(1, 1, 1))).toBe(2);
  });
});
