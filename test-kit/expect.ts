import { loadConfig } from "../lib/config";
import { MIN_CHANNEL_RESERVE_CKB, SHANNON_PER_CKB } from "../lib/constants";
import { runLogPath } from "../lib/runlog/store";
import { mapError } from "../lib/scenario/errorCategory";
import type { ErrorCategory } from "../lib/scenario/schema";
import type { ScenarioContext } from "./context";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PaymentState {
  status: string;
  failed_error?: unknown;
}

/** Poll get_payment tới Success/Failed hoặc hết timeout (trả trạng thái cuối để caller assert) — FNN không push event. */
async function pollPayment(ctx: ScenarioContext, node: string, paymentId: string): Promise<PaymentState> {
  const config = loadConfig();
  const deadline = Date.now() + config.pollTimeoutMs;
  while (true) {
    const p = (await ctx.call(node, "get_payment", [{ payment_hash: paymentId }])) as PaymentState;
    if (p.status === "Success" || p.status === "Failed") return p;
    if (Date.now() > deadline) return p;
    await sleep(config.pollIntervalMs);
  }
}

function payerFor(ctx: ScenarioContext, paymentId: string): string {
  const step = ctx.store.data.steps.find(
    (s) => s.action === "send_payment" && (s.result as { payment_hash?: string } | null)?.payment_hash === paymentId,
  );
  return (step?.input as { from?: string } | null)?.from ?? ctx.lastPaymentFrom ?? "";
}

async function fail(ctx: ScenarioContext, message: string): Promise<never> {
  await ctx.store.save();
  throw new Error(`${message} — run-log: ${runLogPath(ctx.runId)}`);
}

/** Assert payment tới trạng thái Success (poll RPC). Mặc định kiểm payment cuối của scenario. */
export async function expectPaymentSucceeds(
  ctx: ScenarioContext,
  paymentId: string | null = ctx.lastPaymentId,
): Promise<void> {
  if (!paymentId) await fail(ctx, `expectPaymentSucceeds: không có payment để kiểm (run ${ctx.runId})`);
  const final = await pollPayment(ctx, payerFor(ctx, paymentId!), paymentId!);
  if (final.status !== "Success") {
    await fail(ctx, `expectPaymentSucceeds: payment ${paymentId!.slice(0, 12)}… status ${final.status} (mong Success)`);
  }
}

/**
 * Assert payment thất bại. Payment lỗi đồng bộ (không hash) → đọc lỗi thô đã ghi; lỗi bất đồng bộ → poll tới Failed.
 * Nếu `reason` được truyền, map lỗi thô → ErrorCategory và so khớp.
 */
export async function expectPaymentFails(
  ctx: ScenarioContext,
  paymentId: string | null = ctx.lastPaymentId,
  reason?: ErrorCategory,
): Promise<void> {
  if (!paymentId) {
    const last = [...ctx.store.data.steps].reverse().find((s) => s.action === "send_payment");
    const error = (last?.result as { error?: unknown } | null)?.error;
    if (error === undefined) await fail(ctx, `expectPaymentFails: không có payment nào (run ${ctx.runId})`);
    await assertReason(ctx, String(error), reason);
    return;
  }

  const final = await pollPayment(ctx, payerFor(ctx, paymentId), paymentId);
  if (final.status !== "Failed") {
    await fail(ctx, `expectPaymentFails: payment ${paymentId.slice(0, 12)}… status ${final.status} (mong Failed)`);
  }
  await assertReason(ctx, String(final.failed_error ?? ""), reason);
}

async function assertReason(ctx: ScenarioContext, message: string, reason?: ErrorCategory): Promise<void> {
  if (!reason) return;
  const actual = mapError(message);
  if (actual !== reason) {
    await fail(ctx, `expectPaymentFails: reason "${actual ?? "unknown"}" ≠ mong "${reason}" (raw: ${message.slice(0, 120)})`);
  }
}

export interface ChannelStateExpectation {
  status?: string; // state_name, VD "ChannelReady"
  capacity?: number; // funding capacity (CKB)
}

interface ChannelInfo {
  channel_id: string;
  state: { state_name: string };
  local_balance: string;
  remote_balance: string;
}

async function findChannel(ctx: ScenarioContext, channelId: string): Promise<ChannelInfo | null> {
  for (const node of ctx.scenario.nodes) {
    const res = (await ctx.call(node, "list_channels", [{}])) as { channels: ChannelInfo[] };
    const channel = res.channels.find((c) => c.channel_id === channelId);
    if (channel) return channel;
  }
  return null;
}

/**
 * Assert state_name và/hoặc capacity của 1 channel (poll list_channels tới khi status khớp).
 * capacity = local + remote + reserve (list_channels KHÔNG có field funding; kênh single-funded ⇒ 1 reserve).
 */
export async function expectChannelState(
  ctx: ScenarioContext,
  channelId: string,
  expected: ChannelStateExpectation,
): Promise<void> {
  const config = loadConfig();
  const deadline = Date.now() + config.pollTimeoutMs;

  let channel = await findChannel(ctx, channelId);
  while (expected.status !== undefined && channel?.state.state_name !== expected.status && Date.now() < deadline) {
    await sleep(config.pollIntervalMs);
    channel = await findChannel(ctx, channelId);
  }

  if (!channel) await fail(ctx, `expectChannelState: không tìm thấy channel ${channelId.slice(0, 12)}…`);
  if (expected.status !== undefined && channel!.state.state_name !== expected.status) {
    await fail(ctx, `expectChannelState: state "${channel!.state.state_name}" ≠ mong "${expected.status}"`);
  }
  if (expected.capacity !== undefined) {
    const balances = BigInt(channel!.local_balance) + BigInt(channel!.remote_balance);
    const capacity = Number(balances / SHANNON_PER_CKB) + MIN_CHANNEL_RESERVE_CKB;
    if (capacity !== expected.capacity) {
      await fail(ctx, `expectChannelState: capacity ${capacity} CKB ≠ mong ${expected.capacity} CKB`);
    }
  }
}
