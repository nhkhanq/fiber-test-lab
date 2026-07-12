import { describe, expect, it } from "vitest";
import { expectPaymentFails, expectPaymentSucceeds, setupScenario } from "fiber-test-lab/test-kit";

const TIMEOUT_MS = 300_000;

describe("test-kit examples", () => {
  it(
    "direct-channel: payment succeeds",
    async () => {
      const ctx = await setupScenario("direct-channel");
      try {
        await expectPaymentSucceeds(ctx);
      } finally {
        await ctx.reset();
      }
    },
    TIMEOUT_MS,
  );

  it(
    "insufficient-capacity: payment fails with reason insufficient_outbound",
    async () => {
      const ctx = await setupScenario("insufficient-capacity");
      try {
        await expectPaymentFails(ctx, ctx.lastPaymentId, "insufficient_outbound");
        expect(ctx.lastPaymentId, "synchronous failure -> no hash").toBeNull();
      } finally {
        await ctx.reset();
      }
    },
    TIMEOUT_MS,
  );

  it(
    "peer-offline: payment fails with reason peer_offline",
    async () => {
      const ctx = await setupScenario("peer-offline");
      try {
        await expectPaymentFails(ctx, ctx.lastPaymentId, "peer_offline");
      } finally {
        await ctx.reset();
      }
    },
    TIMEOUT_MS,
  );

  it(
    "expired-invoice: payment fails with reason invoice_expired",
    async () => {
      const ctx = await setupScenario("expired-invoice");
      try {
        await expectPaymentFails(ctx, ctx.lastPaymentId, "invoice_expired");
      } finally {
        await ctx.reset();
      }
    },
    TIMEOUT_MS,
  );
});
