import { describe, expect, it } from "vitest";
import { setupScenario } from "fiber-test-lab/test-kit";

const TIMEOUT_MS = 300_000;

describe("test-kit examples: event-driven", () => {
  it(
    "chờ payment Success qua subscribe_store_changes (WS), không poll",
    async () => {
      const ctx = await setupScenario("direct-channel");
      const watcher = await ctx.watchPayments("alice");
      try {
        // Subscribe TRƯỚC khi gửi → không lỡ event. Gửi 1 payment mới, chờ bằng event.
        const bob = (await ctx.call("bob", "node_info")) as { pubkey: string };
        const res = (await ctx.call("alice", "send_payment", [
          { target_pubkey: bob.pubkey, amount: "0x2540be400", keysend: true },
        ])) as { payment_hash: string };

        const final = await watcher.wait(res.payment_hash);
        expect(final.status).toBe("Success");
      } finally {
        watcher.close();
        await ctx.reset();
      }
    },
    TIMEOUT_MS,
  );
});
