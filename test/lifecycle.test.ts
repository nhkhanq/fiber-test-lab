import { randomBytes } from "node:crypto";
import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import {
  expectBalance,
  expectInvoiceStatus,
  expectOnchainCapacity,
  setupScenario,
  type ScenarioContext,
} from "../test-kit";
import type { ScenarioInput } from "../lib/scenario/schema";

const TIMEOUT_MS = 300_000;

const ready = (node: string, peer: string): NonNullable<ScenarioInput["seed"]>[number] => ({
  action: "assert",
  expect: { channels: [{ node, peer, state: "ChannelReady" }] },
});

const route: ScenarioInput = {
  name: "lifecycle-route",
  nodes: ["member", "hub", "organizer"],
  channels: [
    { from: "member", to: "hub", capacity: 1000 },
    { from: "hub", to: "organizer", capacity: 1000 },
  ],
  seed: [ready("member", "hub")],
};

const pair: ScenarioInput = {
  name: "lifecycle-pair",
  nodes: ["alice", "bob"],
  channels: [{ from: "alice", to: "bob", capacity: 500 }],
  seed: [ready("alice", "bob")],
};

async function withScenario(input: ScenarioInput, run: (ctx: ScenarioContext) => Promise<void>): Promise<void> {
  const ctx = await setupScenario(input);
  try {
    await run(ctx);
  } finally {
    await ctx.reset();
  }
}

describe("hold invoices from code", () => {
  it(
    "locks, refuses a wrong secret, settles; and cancels back to the payer",
    async () => {
      await withScenario(route, async (ctx) => {
        const invoice = await ctx.newHoldInvoice("organizer", 10, { finalExpiryDeltaSec: 86400 });
        expect(invoice).toMatchObject({ hold: true, node: "organizer" });
        expect(await ctx.settleInvoice(invoice)).toMatchObject({ ok: false, error: expect.stringMatching(/still open/i) });

        const opened = await ctx.balances("member", { peer: "hub" });
        const locked = await ctx.payInvoice("member", invoice, { waitFor: "inflight" });
        expect(locked).toMatchObject({ state: "inflight", succeeded: false, status: "Inflight", reason: null });
        await expectInvoiceStatus(ctx, invoice, "Received");
        await expectBalance(ctx, { node: "member", peer: "hub", local: Number(opened.local) / 1e8, offered: 10.01 });
        expect((await ctx.balances("organizer")).received).toBe(1_000_000_000n);

        const wrong = await ctx.settleInvoice(invoice, { preimage: `0x${"22".repeat(32)}` });
        expect(wrong).toMatchObject({ ok: false, error: expect.stringMatching(/hash mismatch/i) });

        expect(await ctx.settleInvoice(invoice)).toEqual({ ok: true, error: null });
        expect(await ctx.awaitPayment(locked)).toMatchObject({ state: "succeeded", succeeded: true, status: "Success" });
        await expectBalance(ctx, { node: "organizer", peer: "hub", local: 10, received: 0 });

        // The payer makes the secret and the receiver only ever sees its hash.
        const secret = `0x${randomBytes(32).toString("hex")}`;
        const theirs = await ctx.newHoldInvoice("organizer", 5, { paymentHash: ccc.hashCkb(secret), finalExpiryDeltaSec: 86400 });
        expect(theirs.preimage).toBeNull();
        const cancelled = await ctx.payInvoice("member", theirs, { waitFor: "inflight" });
        await expectInvoiceStatus(ctx, theirs, "Received");
        expect(await ctx.cancelInvoice(theirs)).toEqual({ ok: true, error: null });
        expect(await ctx.awaitPayment(cancelled)).toMatchObject({ state: "failed", reason: "invoice_cancelled" });
        await expectBalance(ctx, { node: "member", peer: "hub", offered: 0 });
      });
    },
    TIMEOUT_MS,
  );
});

describe("connectivity from code", () => {
  it(
    "reports an undecided payment as a timeout, then follows it to the end",
    async () => {
      await withScenario(pair, async (ctx) => {
        await ctx.pauseNode("bob");
        const undecided = await ctx.pay("alice", "bob", 10, { timeoutMs: 3000 });
        expect(undecided).toMatchObject({ state: "timeout", succeeded: false, error: null, reason: null });
        expect(undecided.paymentHash).toBeTruthy();

        await ctx.resumeNode("bob");
        expect(await ctx.awaitPayment(undecided)).toMatchObject({ state: "succeeded" });

        await ctx.disconnectPeer("alice", "bob");
        expect(await ctx.pay("alice", "bob", 1)).toMatchObject({ state: "failed", reason: "peer_offline" });
        await ctx.connectPeer("alice", "bob");
        expect(await ctx.pay("alice", "bob", 1)).toMatchObject({ state: "succeeded" });
      });
    },
    TIMEOUT_MS,
  );

  it(
    "keeps talking to a node that restarted on a new port",
    async () => {
      await withScenario(pair, async (ctx) => {
        expect((await ctx.pay("alice", "bob", 10)).succeeded).toBe(true);
        const before = ctx.endpoints.bob;

        await ctx.killNode("bob");
        await ctx.startNode("bob");

        expect(ctx.endpoints.bob).not.toBe(before);
        expect(ctx.store.data.nodes.find((n) => n.name === "bob")?.endpoint).toBe(ctx.endpoints.bob);
        expect(await ctx.call("bob", "node_info")).toMatchObject({ node_name: "bob" });
        await expectBalance(ctx, { node: "bob", peer: "alice", local: 10 });
        expect(await ctx.pay("bob", "alice", 1)).toMatchObject({ state: "succeeded" });
      });
    },
    TIMEOUT_MS,
  );

  it(
    "cleans up a run that ended with a node still frozen",
    async () => {
      await withScenario(pair, async (ctx) => {
        await ctx.pauseNode("bob");
      });
    },
    TIMEOUT_MS,
  );
});

describe("closing channels from code", () => {
  it(
    "closes cooperatively, refuses a second close, and force-closes another channel",
    async () => {
      await withScenario(route, async (ctx) => {
        const hubBefore = await ctx.onchainCapacity("hub");
        const closed = await ctx.closeChannel("hub", "organizer");
        expect(closed).toMatchObject({ ok: true, error: null, flags: "COOPERATIVE" });
        expect(closed.channelId).toBeTruthy();
        expect(await ctx.closeChannel("hub", "organizer")).toMatchObject({ ok: false, error: expect.stringMatching(/no open channel/) });
        await ctx.mine(2);
        const returned = (await ctx.onchainCapacity("hub")) - hubBefore;
        expect(returned, "the funder gets its balance back, less the closing fee").toBeGreaterThan(90_000_000_000n);

        const memberBefore = await ctx.onchainCapacity("member");
        const forced = await ctx.closeChannel("member", "hub", { force: true });
        expect(forced.ok, forced.error ?? "").toBe(true);
        expect(forced.flags).toContain("UNCOOPERATIVE_LOCAL");
        await ctx.advanceEpochs(8);
        await expectOnchainCapacity(ctx, "member", { min: Number((memberBefore + 99_900_000_000n) / 100_000_000n) });
      });
    },
    TIMEOUT_MS,
  );
});
