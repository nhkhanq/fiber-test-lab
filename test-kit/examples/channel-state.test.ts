import { describe, expect, it } from "vitest";
import { expectChannelState, setupScenario } from "fiber-test-lab/test-kit";

const TIMEOUT_MS = 300_000;

describe("test-kit examples: channel state", () => {
  it(
    "direct-channel: kênh alice→bob ChannelReady, capacity 500 CKB",
    async () => {
      const ctx = await setupScenario("direct-channel");
      try {
        const res = (await ctx.call("alice", "list_channels", [{}])) as {
          channels: { channel_id: string }[];
        };
        const channelId = res.channels[0]?.channel_id;
        expect(channelId, "alice phải có 1 channel").toBeTruthy();

        await expectChannelState(ctx, channelId!, { status: "ChannelReady", capacity: 500 });
      } finally {
        await ctx.reset();
      }
    },
    TIMEOUT_MS,
  );
});
