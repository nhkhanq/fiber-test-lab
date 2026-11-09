import { describe, expect, it } from "vitest";
import {
  expectBalance,
  expectFee,
  expectInvoiceStatus,
  setupScenario,
} from "fiber-test-lab/test-kit";

const TIMEOUT_MS = 300_000;

describe("test-kit examples: driving a run from code", () => {
  it(
    "declares a topology inline, then pays and asserts step by step",
    async () => {
      const ctx = await setupScenario({
        name: "checkout",
        nodes: ["shopper", "merchant"],
        channels: [{ from: "shopper", to: "merchant", capacity: 500 }],
        seed: [{ action: "assert", expect: { channels: [{ node: "shopper", peer: "merchant", state: "ChannelReady" }] } }],
      });
      try {
        const invoice = await ctx.newInvoice("merchant", 25);
        const payment = await ctx.payInvoice("shopper", invoice);

        expect(payment.succeeded).toBe(true);
        await expectFee(ctx, 0);
        await expectInvoiceStatus(ctx, invoice, "Paid");
        await expectBalance(ctx, { node: "merchant", peer: "shopper", local: 25 });
      } finally {
        await ctx.reset();
      }
    },
    TIMEOUT_MS,
  );
});
