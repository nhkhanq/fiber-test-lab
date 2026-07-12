import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  setupScenario,
  expectPaymentSucceeds,
  expectPaymentFails,
  expectChannelState,
} from "fiber-test-lab/test-kit";

const TIMEOUT = 300_000;

// A mock Fiber payment service testing its own assumptions against controlled Fiber scenarios,
// using fiber-test-lab as a dependency. The scenarios below are THIS project's own YAML files.
describe("checkout payment flow", () => {
  it("a customer checkout settles over a direct channel", { timeout: TIMEOUT }, async () => {
    const ctx = await setupScenario("./scenarios/shop-checkout.yaml");
    try {
      await expectPaymentSucceeds(ctx);

      const { channels } = (await ctx.call("customer", "list_channels", [{}])) as {
        channels: { channel_id: string }[];
      };
      assert.ok(channels[0], "customer should have a channel");
      await expectChannelState(ctx, channels[0].channel_id, { status: "ChannelReady", capacity: 500 });
    } finally {
      await ctx.reset();
    }
  });

  it("an over-limit payment fails with insufficient_outbound", { timeout: TIMEOUT }, async () => {
    const ctx = await setupScenario("./scenarios/over-limit.yaml");
    try {
      await expectPaymentFails(ctx, ctx.lastPaymentId, "insufficient_outbound");
      assert.equal(ctx.lastPaymentId, null, "an over-limit payment fails synchronously (no hash)");
    } finally {
      await ctx.reset();
    }
  });
});
