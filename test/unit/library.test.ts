import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, PROJECT_CONFIG_FILE } from "../../lib/config";
import { PACKAGE_ROOT } from "../../lib/constants";
import { checkNode } from "../../lib/docker/doctor";
import { CliError } from "../../lib/errors";
import { RunLogSchema } from "../../lib/runlog/store";
import { scenarioFromLog } from "../../lib/scenario/attach";
import { describeEnvironment, renderDotenv } from "../../lib/scenario/environment";
import { parseScenario, ScenarioValidationError } from "../../lib/scenario/loader";

const at = "2026-11-09T00:00:00.000Z";

const project = (contents?: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "fiber-lab-config-"));
  if (contents !== undefined) writeFileSync(join(dir, PROJECT_CONFIG_FILE), contents);
  return dir;
};

describe("project configuration", () => {
  it("uses the shipped defaults when a project has no file", () => {
    expect(loadConfig({}, project()).pollIntervalMs).toBe(1000);
  });

  it("lets a project override settings in a JSON file", () => {
    const dir = project(JSON.stringify({ pollTimeoutMs: 5000, maxNodesPerScenario: 6 }));
    expect(loadConfig({}, dir)).toMatchObject({ pollTimeoutMs: 5000, maxNodesPerScenario: 6, pollIntervalMs: 1000 });
  });

  it("orders file, then environment, then code", () => {
    const dir = project(JSON.stringify({ pollTimeoutMs: 1, maxNodesPerScenario: 2, blockIntervalMs: 3 }));
    const config = loadConfig({ FIBER_LAB_POLL_TIMEOUT_MS: "10", FIBER_LAB_MAX_NODES: "4" }, dir, { maxNodesPerScenario: 5 });
    expect(config).toMatchObject({ blockIntervalMs: 3, pollTimeoutMs: 10, maxNodesPerScenario: 5 });
  });

  it("names the key that is wrong, as a validation error", () => {
    for (const contents of [JSON.stringify({ pollTimeout: 5 }), JSON.stringify({ pollTimeoutMs: "soon" })]) {
      let thrown: unknown;
      try {
        loadConfig({}, project(contents));
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(CliError);
      expect((thrown as CliError).exitCode).toBe(1);
      expect((thrown as CliError).message).toMatch(/pollTimeout/);
    }
  });

  it("reports a file that is not JSON", () => {
    expect(() => loadConfig({}, project("{ nope"))).toThrow(new RegExp(PROJECT_CONFIG_FILE));
  });

  it("rejects a number the environment got wrong", () => {
    expect(() => loadConfig({ FIBER_LAB_POLL_TIMEOUT_MS: "soon" }, project())).toThrow(/pollTimeoutMs/);
  });
});

function log(overrides: object = {}) {
  return RunLogSchema.parse({
    runId: "r1",
    scenario: "demo",
    status: "completed",
    startedAt: at,
    network: "flab_r1",
    versions: { fnn: "0.9.1", ckb: "0.207.0" },
    nodes: [
      { name: "ckb", container: "c", endpoint: "http://127.0.0.1:1" },
      { name: "alice", container: "a", endpoint: "http://127.0.0.1:2" },
      { name: "bob-2", container: "b", endpoint: "http://127.0.0.1:3" },
    ],
    steps: [
      {
        action: "chain_ready",
        at,
        result: {
          facts: { hash: "0xg", simpleUdt: { codeHash: "0xc", txHash: "0xt", index: 8 }, secp256k1DepGroup: { txHash: "0xd", index: 0 } },
        },
      },
    ],
    rpcCalls: [
      {
        node: "alice",
        method: "node_info",
        params: [],
        at,
        response: {
          pubkey: "02aa",
          addresses: ["/ip4/0.0.0.0/tcp/1", "/dns4/alice/tcp/8228/p2p/Qm"],
          default_funding_lock_script: { code_hash: "0x9b", hash_type: "type", args: "0xf9" },
        },
      },
    ],
    ...overrides,
  });
}

describe("describing a run to another program", () => {
  it("collects endpoints, identity and devnet facts from the run-log", () => {
    const environment = describeEnvironment(log());
    expect(environment).toMatchObject({ runId: "r1", status: "completed", versions: { fnn: "0.9.1" } });
    expect(environment.ckb).toEqual({
      rpc: "http://127.0.0.1:1",
      genesis: { hash: "0xg", simpleUdt: { codeHash: "0xc", txHash: "0xt", index: 8 }, secp256k1DepGroup: { txHash: "0xd", index: 0 } },
    });
    expect(environment.nodes.alice).toEqual({
      name: "alice",
      rpc: "http://127.0.0.1:2",
      pubkey: "02aa",
      address: "/dns4/alice/tcp/8228/p2p/Qm",
      lock: { code_hash: "0x9b", hash_type: "type", args: "0xf9" },
      privateKey: `0x${"11".repeat(32)}`,
    });
  });

  it("does not list the chain as a node, and gives each node its own key", () => {
    const environment = describeEnvironment(log());
    expect(Object.keys(environment.nodes)).toEqual(["alice", "bob-2"]);
    expect(environment.nodes["bob-2"]?.privateKey).toBe(`0x${"22".repeat(32)}`);
    expect(environment.nodes["bob-2"]?.pubkey).toBeNull();
  });

  it("writes dotenv lines with names a shell accepts", () => {
    const text = renderDotenv(describeEnvironment(log()));
    expect(text).toContain("FIBER_LAB_RUN_ID=r1\n");
    expect(text).toContain("FIBER_LAB_CKB_RPC=http://127.0.0.1:1\n");
    expect(text).toContain("FIBER_LAB_NODE_ALICE_PUBKEY=02aa\n");
    expect(text).toContain("FIBER_LAB_NODE_BOB_2_RPC=http://127.0.0.1:3\n");
    expect(text.split("\n").filter(Boolean).every((l) => /^[A-Z0-9_]+=/.test(l))).toBe(true);
  });
});

describe("attaching to a run", () => {
  const step = (action: string, input: object, result: object = {}) => ({ action, input, result, at });

  it("rebuilds the topology from what actually happened", () => {
    const scenario = scenarioFromLog(
      log({
        steps: [
          step("open_channel", { from: "alice", to: "bob-2", capacity: 500, asset: "CKB" }),
          step("open_channel", { from: "alice", to: "bob-2", capacity: 600, asset: "CKB" }, { error: "boom" }),
          step("open_channel", { from: "bob-2", to: "alice", capacity: 700, asset: "CKB" }),
          step("close_channel", { from: "bob-2", to: "alice", force: false }, { channelId: "c" }),
          step("close_channel", { from: "alice", to: "bob-2" }, { error: "refused" }),
        ],
      }),
    );
    expect(scenario.nodes).toEqual(["alice", "bob-2"]);
    expect(scenario.channels).toEqual([{ from: "bob-2", to: "alice", capacity: 700, asset: "CKB" }]);
  });
});

describe("scenarios with no seed", () => {
  const issuesOf = (input: unknown) => {
    try {
      parseScenario(input);
      return [];
    } catch (error) {
      return (error as ScenarioValidationError).issues.map((i) => i.path);
    }
  };

  it("may declare no expectation: they are an environment for something else to test against", () => {
    expect(issuesOf({ name: "env", nodes: ["a", "b"], channels: [{ from: "a", to: "b", capacity: 500 }] })).toEqual([]);
  });

  it("still refuses a seed that acts without checking anything", () => {
    expect(issuesOf({ name: "x", nodes: ["a"], seed: [{ action: "mine" }] })).toContain("expect");
  });
});

describe("doctor", () => {
  it("knows the oldest Node.js the launcher works on", () => {
    expect(checkNode("20.6.0").ok).toBe(true);
    expect(checkNode("22.1.0").ok).toBe(true);
    expect(checkNode("20.5.1")).toMatchObject({ ok: false, detail: expect.stringContaining("20.6") });
    expect(checkNode("18.20.0").ok).toBe(false);
  });
});

describe("what the package promises", () => {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
    bin: Record<string, string>;
    exports: Record<string, { types: string; default: string }>;
    files: string[];
  };

  it("points its binary at a file Node can start on every platform", () => {
    expect(pkg.bin["fiber-lab"]).toBe("bin/fiber-lab.mjs");
    expect(existsSync(join(PACKAGE_ROOT, pkg.bin["fiber-lab"]!))).toBe(true);
    expect(pkg.files).toContain("bin");
  });

  it("ships the declarations it advertises", () => {
    expect(pkg.files).toContain("types");
    for (const target of Object.values(pkg.exports)) expect(target.types).toMatch(/^\.\/types\/.*\.d\.ts$/);
  });

  const namesIn = (file: string) =>
    /export const \{([^}]*)\}/.exec(readFileSync(join(PACKAGE_ROOT, file), "utf8"))![1]!
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .sort();

  it("exports the same names from the plain-Node entry as from the source", async () => {
    expect(namesIn("test-kit/entry.mjs")).toEqual(Object.keys(await import("../../test-kit/index")).sort());
    expect(namesIn("lib/report/entry.mjs")).toEqual(Object.keys(await import("../../lib/report/index")).sort());
  });
});

