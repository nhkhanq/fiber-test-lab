import { describe, expect, it } from "vitest";
import { GlobalConfigSchema, loadConfig } from "../../lib/config";
import {
  checkScenarioLimits,
  listScenarios,
  loadAllScenarios,
  parseScenario,
  ScenarioValidationError,
} from "../../lib/scenario/loader";
import type { ScenarioInput } from "../../lib/scenario/schema";

const pay = { action: "send_payment", from: "alice", to: "bob", amount: 100 } as const;
const base: ScenarioInput = {
  name: "t",
  nodes: ["alice", "bob"],
  channels: [{ from: "alice", to: "bob", capacity: 500 }],
  seed: [pay],
  expect: { status: "succeeded" },
};

function issuesOf(input: unknown): { path: string; message: string }[] {
  try {
    parseScenario(input);
  } catch (error) {
    if (error instanceof ScenarioValidationError) return error.issues;
    throw error;
  }
  return [];
}

const mentions = (input: unknown, text: RegExp) => issuesOf(input).some((i) => text.test(`${i.path} ${i.message}`));

describe("scenario schema", () => {
  it("accepts a scenario and fills in defaults", () => {
    const scenario = parseScenario(base);
    expect(scenario.chain.mining).toBe("manual");
    expect(scenario.tags).toEqual([]);
    expect(scenario.channels[0]!.asset).toBe("CKB");
  });

  it("validates every built-in scenario", async () => {
    const summaries = await listScenarios();
    expect(summaries.length).toBeGreaterThanOrEqual(9);
    expect(summaries.filter((s) => !s.valid)).toEqual([]);
    expect((await loadAllScenarios()).every((s) => s.tags.length > 0)).toBe(true);
  });

  it("rejects unknown keys instead of silently dropping them", () => {
    expect(mentions({ ...base, channels: [{ from: "alice", to: "bob", capacity: 500, push: 10 }] }, /push/)).toBe(true);
    expect(mentions({ ...base, seed: [{ ...pay, expiresInSecs: 3 }] }, /expiresInSecs/)).toBe(true);
    expect(mentions({ ...base, expects: {} }, /expects/)).toBe(true);
  });

  it("rejects an amount that cannot be represented, naming the field", () => {
    expect(issuesOf({ ...base, seed: [{ ...pay, amount: 0.123456789 }] })[0]?.path).toBe("seed.0.amount");
    expect(issuesOf({ ...base, seed: [{ ...pay, amount: 1.5, asset: "RUSD" }] })[0]?.path).toBe("seed.0.amount");
    expect(issuesOf({ ...base, channels: [{ from: "alice", to: "bob", capacity: 500.123456789 }] })[0]?.path).toBe(
      "channels.0.capacity",
    );
    expect(issuesOf({ ...base, seed: [{ ...pay, amount: 0.5 }] })).toEqual([]);
  });

  it("only accepts failure reasons a classifier can produce", () => {
    const failed = (reason: string) => ({ ...base, expect: { status: "failed", reason } });
    expect(issuesOf(failed("insufficient_outbound"))).toEqual([]);
    for (const reason of ["insufficient_inbound", "amount_out_of_range", "asset_mismatch", "channel_not_ready", "reserve_violation"]) {
      expect(mentions(failed(reason), /expect\.reason/), reason).toBe(true);
    }
  });

  it("refuses a top-level expect with no payment to check", () => {
    const noPayment = { ...base, seed: [{ action: "wait", durationSec: 1 }] };
    expect(mentions(noPayment, /no send_payment step/)).toBe(true);
  });

  it("refuses a scenario with no expectation anywhere", () => {
    const { expect: _ignored, ...rest } = base;
    expect(mentions(rest, /needs an expectation/)).toBe(true);
  });

  it("accepts expectations declared only on steps", () => {
    const { expect: _ignored, ...rest } = base;
    const scenario = { ...rest, seed: [{ ...pay, expect: { status: "succeeded" } }] };
    expect(issuesOf(scenario)).toEqual([]);
  });

  it("keeps reason tied to a failed status, on steps too", () => {
    expect(mentions({ ...base, seed: [{ ...pay, expect: { status: "succeeded", reason: "peer_offline" } }] }, /reason/)).toBe(true);
  });

  it("keeps payment checks on payment steps", () => {
    const step = { action: "mine", expect: { fee: 1, balances: [{ node: "alice", local: 1 }] } };
    expect(mentions({ ...base, seed: [pay, step] }, /seed\.1\.expect\.fee/)).toBe(true);
  });

  it("refuses a delta on an assert step, which has no before", () => {
    const step = { action: "assert", expect: { balances: [{ node: "alice", localDelta: 1 }] } };
    expect(mentions({ ...base, seed: [pay, step] }, /no "before"/)).toBe(true);
  });

  it("requires a value to compare in balance and on-chain checks", () => {
    const balance = { action: "assert", expect: { balances: [{ node: "alice" }] } };
    const onchain = { action: "assert", expect: { onchain: [{ node: "alice" }] } };
    expect(mentions({ ...base, seed: [pay, balance] }, /balance check needs/)).toBe(true);
    expect(mentions({ ...base, seed: [pay, onchain] }, /on-chain check needs/)).toBe(true);
  });

  it("requires a range to have a bound", () => {
    const step = { ...pay, expect: { fee: {} } };
    expect(mentions({ ...base, seed: [step] }, /range needs/)).toBe(true);
  });

  it("checks that nodes named inside expectations exist", () => {
    const step = {
      action: "assert",
      expect: {
        balances: [{ node: "mallory", local: 1 }],
        channels: [{ node: "alice", peer: "eve", state: "ChannelReady" }],
        invoices: [{ node: "trent", status: "Paid" }],
        onchain: [{ node: "oscar", capacity: 1 }],
      },
    };
    const messages = issuesOf({ ...base, seed: [pay, step] }).map((i) => i.message).join(" ");
    for (const name of ["mallory", "eve", "trent", "oscar"]) expect(messages).toContain(`"${name}"`);
  });

  it("requires the fields each new action depends on", () => {
    expect(mentions({ ...base, seed: [pay, { action: "advance_epochs" }] }, /seed\.1\.epochs/)).toBe(true);
    expect(mentions({ ...base, seed: [pay, { action: "assert" }] }, /seed\.1\.expect/)).toBe(true);
    expect(issuesOf({ ...base, seed: [pay, { action: "mine" }] })).toEqual([]);
  });

  it("rejects an unknown channel state", () => {
    const step = { action: "assert", expect: { channels: [{ node: "alice", peer: "bob", state: "Open" }] } };
    expect(mentions({ ...base, seed: [pay, step] }, /state/)).toBe(true);
  });
});

describe("machine limits", () => {
  const config = GlobalConfigSchema.parse({ fnnVersion: "0.9.1", maxNodesPerScenario: 5 });

  it("fails a scenario over the configured node limit as a validation error", () => {
    const scenario = parseScenario({ ...base, nodes: ["alice", "bob", "c", "d", "e", "f"] });
    expect(() => checkScenarioLimits(scenario, config)).toThrow(ScenarioValidationError);
    expect(() => checkScenarioLimits(parseScenario({ ...base, nodes: ["alice", "bob", "c", "d", "e"] }), config)).not.toThrow();
  });

  it("refuses more nodes than genesis funds, even if the limit is raised", () => {
    const raised = { ...config, maxNodesPerScenario: 50 };
    const nodes = ["alice", "bob", "c", "d", "e", "f", "g"];
    expect(() => checkScenarioLimits(parseScenario({ ...base, nodes }), raised)).toThrow(/funded in genesis/);
  });

  it("refuses a node named after the chain service", () => {
    expect(() => checkScenarioLimits(parseScenario({ ...base, nodes: ["alice", "bob", "ckb"] }), config)).toThrow(/collides/);
  });
});

describe("global config", () => {
  it("lets the environment choose the FNN version", () => {
    expect(loadConfig({ FIBER_LAB_FNN_VERSION: "0.10.0-rc1" }).fnnVersion).toBe("0.10.0-rc1");
    expect(loadConfig({ FIBER_LAB_IMAGE_REGISTRY: "ghcr.io/acme" }).imageRegistry).toBe("ghcr.io/acme");
  });

  it("rejects a version that could not name a release", () => {
    expect(() => loadConfig({ FIBER_LAB_FNN_VERSION: "latest" })).toThrow();
    expect(() => loadConfig({ FIBER_LAB_FNN_VERSION: "v0.9.1" })).toThrow();
  });
});
