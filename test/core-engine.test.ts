import { describe, expect, it } from "vitest";
import {
  expectBalance,
  expectChannelState,
  expectFee,
  expectInvoiceStatus,
  expectOnchainCapacity,
  expectPaymentFails,
  expectPaymentSucceeds,
  setupScenario,
  type ScenarioContext,
} from "../test-kit";
import type { ScenarioInput } from "../lib/scenario/schema";

const TIMEOUT_MS = 300_000;

async function withScenario(input: string | ScenarioInput, run: (ctx: ScenarioContext) => Promise<void>): Promise<void> {
  const ctx = await setupScenario(input);
  try {
    await run(ctx);
  } finally {
    await ctx.reset();
  }
}

const pair = {
  nodes: ["alice", "bob"],
  channels: [{ from: "alice", to: "bob", capacity: 500 }],
};
const noopExpect: NonNullable<ScenarioInput["seed"]>[number] = { action: "assert", expect: { channels: [{ node: "alice", peer: "bob", state: "ChannelReady" }] } };

describe("chain control", () => {
  it(
    "the chain stands still between steps and moves only when mined",
    async () => {
      await withScenario({ name: "chain-control", ...pair, seed: [noopExpect] }, async (ctx) => {
        const tip = await tipOf(ctx);
        await new Promise((r) => setTimeout(r, 6000));
        expect(await tipOf(ctx), "no miner runs in manual mode").toBe(tip);

        expect(await ctx.mine(3)).toBe(tip + 3n);
        const afterEpochs = await ctx.advanceEpochs(2);
        expect(afterEpochs, "two epochs of ten blocks").toBeGreaterThanOrEqual(tip + 3n + 10n);
      });
    },
    TIMEOUT_MS,
  );

  it(
    "auto mining keeps the chain moving for an app that opens channels itself",
    async () => {
      await withScenario({ name: "chain-auto", chain: { mining: "auto" }, ...pair, seed: [noopExpect] }, async (ctx) => {
        const tip = await tipOf(ctx);
        const deadline = Date.now() + 30_000;
        while ((await tipOf(ctx)) === tip && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));
        expect(await tipOf(ctx)).toBeGreaterThan(tip);
      });
    },
    TIMEOUT_MS,
  );
});

async function tipOf(ctx: ScenarioContext): Promise<bigint> {
  return ctx.runtime.chain.tip();
}

describe("per-step expectations", () => {
  it(
    "records a passing check for every kind of expectation",
    async () => {
      const scenario: ScenarioInput = {
        name: "step-checks",
        ...pair,
        seed: [
          { action: "new_invoice", to: "bob", amount: 10, expect: { invoices: [{ node: "bob", status: "Open" }] } },
          {
            action: "send_payment",
            from: "alice",
            to: "bob",
            amount: 10,
            useInvoice: true,
            expect: {
              status: "succeeded",
              fee: 0,
              balances: [{ node: "alice", peer: "bob", localDelta: -10, remoteDelta: 10 }],
              invoices: [{ node: "bob", status: "Paid" }],
            },
          },
          { action: "mine", blocks: 2, expect: { onchain: [{ node: "alice", capacityDelta: 0 }] } },
          {
            action: "assert",
            expect: {
              channels: [{ node: "bob", peer: "alice", state: "ChannelReady" }],
              onchain: [{ node: "bob", capacity: { min: 1 } }],
            },
          },
        ],
      };
      await withScenario(scenario, async (ctx) => {
        expect(ctx.expectation?.failedChecks).toEqual([]);
        expect(ctx.expectation?.match).toBe(true);
        expect(ctx.expectation?.stepChecks).toBeGreaterThanOrEqual(7);
      });
    },
    TIMEOUT_MS,
  );

  it(
    "fails the run and says which check was wrong",
    async () => {
      const scenario: ScenarioInput = {
        name: "step-check-mismatch",
        ...pair,
        seed: [{ action: "send_payment", from: "alice", to: "bob", amount: 10, expect: { status: "succeeded", fee: 5 } }],
      };
      await withScenario(scenario, async (ctx) => {
        expect(ctx.expectation?.match).toBe(false);
        expect(ctx.expectation?.failedChecks.map((f) => f.check.check)).toEqual(["payment fee"]);
      });
    },
    TIMEOUT_MS,
  );
});

describe("programmatic test-kit", () => {
  it(
    "drives a run from code: channels, payments, invoices, assertions",
    async () => {
      await withScenario({ name: "programmatic", ...pair, seed: [noopExpect] }, async (ctx) => {
        const opened = await ctx.balances("alice", { peer: "bob" });
        const direct = await ctx.pay("alice", "bob", 50);
        expect(direct.succeeded).toBe(true);
        await expectPaymentSucceeds(ctx);
        await expectFee(ctx, 0);
        await expectBalance(ctx, { node: "alice", peer: "bob", local: Number(opened.local) / 1e8 - 50, remote: 50 });
        await expectBalance(ctx, { node: "bob", local: { min: 49, max: 51 } });

        const invoice = await ctx.newInvoice("bob", 25);
        await expectInvoiceStatus(ctx, invoice, "Open");
        const paid = await ctx.payInvoice("alice", invoice);
        expect(paid.succeeded).toBe(true);
        await expectInvoiceStatus(ctx, invoice, "Paid");

        const refused = await ctx.pay("alice", "bob", 100_000);
        expect(refused).toMatchObject({ succeeded: false, reason: "insufficient_outbound" });
        await expectPaymentFails(ctx, null, "insufficient_outbound");

        const { channelId } = await ctx.openChannel("bob", "alice", 300);
        await expectChannelState(ctx, channelId, { status: "ChannelReady" });

        const balances = await ctx.balances("bob");
        expect(balances.local, "bob now funds a second channel").toBeGreaterThan(75n * 100_000_000n);

        await ctx.mine();
        await expectOnchainCapacity(ctx, "alice", { min: 1 });
      });
    },
    TIMEOUT_MS,
  );

  it(
    "a node can be killed and brought back, and pays again afterwards",
    async () => {
      await withScenario({ name: "restart", ...pair, seed: [noopExpect] }, async (ctx) => {
        expect((await ctx.pay("alice", "bob", 10)).succeeded).toBe(true);

        await ctx.killNode("bob");
        const offline = await ctx.pay("alice", "bob", 10);
        expect(offline).toMatchObject({ succeeded: false, reason: "peer_offline" });

        await ctx.startNode("bob");
        const deadline = Date.now() + 60_000;
        let back = await ctx.pay("alice", "bob", 10);
        while (!back.succeeded && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 2000));
          back = await ctx.pay("alice", "bob", 10);
        }
        expect(back.succeeded, back.error ?? "").toBe(true);
      });
    },
    TIMEOUT_MS,
  );
});

describe("failures after a payment was accepted", () => {
  it(
    "classifies a payment that dies at an intermediate hop",
    async () => {
      const scenario: ScenarioInput = {
        name: "mid-route-failure",
        nodes: ["alice", "bob", "charlie"],
        channels: [
          { from: "alice", to: "bob", capacity: 500 },
          { from: "bob", to: "charlie", capacity: 500 },
        ],
        seed: [
          { action: "send_payment", from: "bob", to: "charlie", amount: 350, expect: { status: "succeeded" } },
        ],
      };
      await withScenario(scenario, async (ctx) => {
        expect(ctx.expectation?.match, JSON.stringify(ctx.expectation)).toBe(true);
        const outcome = await ctx.pay("alice", "charlie", 100);
        expect(outcome).toMatchObject({ succeeded: false, status: "Failed", reason: "no_route_found" });
        await expectPaymentFails(ctx, outcome.paymentHash, "no_route_found");
      });
    },
    TIMEOUT_MS,
  );
});

describe("more than three nodes", () => {
  it(
    "routes across a four-node diamond",
    async () => {
      const scenario: ScenarioInput = {
        name: "diamond",
        nodes: ["alice", "bob", "carol", "dave"],
        channels: [
          { from: "alice", to: "bob", capacity: 500 },
          { from: "alice", to: "carol", capacity: 500 },
          { from: "bob", to: "dave", capacity: 500 },
          { from: "carol", to: "dave", capacity: 500 },
        ],
        seed: [
          {
            action: "send_payment",
            from: "alice",
            to: "dave",
            amount: 100,
            expect: { status: "succeeded", fee: { min: 0.00000001 }, balances: [{ node: "dave", localDelta: 100 }] },
          },
        ],
      };
      await withScenario(scenario, async (ctx) => {
        expect(ctx.expectation?.failedChecks).toEqual([]);
        expect(ctx.expectation?.match).toBe(true);
      });
    },
    TIMEOUT_MS,
  );
});
