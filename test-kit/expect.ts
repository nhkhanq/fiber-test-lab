import { loadConfig } from "../lib/config";
import { MIN_CHANNEL_RESERVE_CKB, SHANNON_PER_CKB } from "../lib/constants";
import { runLogPath } from "../lib/runlog/store";
import { classifyFailure, mapError } from "../lib/scenario/errorCategory";
import type { ErrorCategory } from "../lib/scenario/schema";
import type { ScenarioContext } from "./context";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PaymentState {
  status: string;
  failed_error?: unknown;
}

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

export async function expectPaymentSucceeds(
  ctx: ScenarioContext,
  paymentId: string | null = ctx.lastPaymentId,
): Promise<void> {
  if (!paymentId) await fail(ctx, `expectPaymentSucceeds: no payment to check (run ${ctx.runId})`);
  const final = await pollPayment(ctx, payerFor(ctx, paymentId!), paymentId!);
  if (final.status !== "Success") {
    await fail(ctx, `expectPaymentSucceeds: payment ${paymentId!.slice(0, 12)}… has status ${final.status} (expected Success)`);
  }
}

export async function expectPaymentFails(
  ctx: ScenarioContext,
  paymentId: string | null = ctx.lastPaymentId,
  reason?: ErrorCategory,
): Promise<void> {
  if (!paymentId) {
    const last = [...ctx.store.data.steps].reverse().find((s) => s.action === "send_payment");
    const result = last?.result as { error?: unknown; peerConnected?: boolean } | null;
    if (!result || result.error === undefined) await fail(ctx, `expectPaymentFails: no payment found (run ${ctx.runId})`);
    await assertReason(ctx, classifyFailure(result), reason);
    return;
  }

  const final = await pollPayment(ctx, payerFor(ctx, paymentId), paymentId);
  if (final.status !== "Failed") {
    await fail(ctx, `expectPaymentFails: payment ${paymentId.slice(0, 12)}… has status ${final.status} (expected Failed)`);
  }
  await assertReason(ctx, mapError(String(final.failed_error ?? "")), reason);
}

async function assertReason(ctx: ScenarioContext, actual: ErrorCategory | null, reason?: ErrorCategory): Promise<void> {
  if (!reason) return;
  if (actual !== reason) {
    await fail(ctx, `expectPaymentFails: reason "${actual ?? "unknown"}" != expected "${reason}"`);
  }
}

export interface ChannelStateExpectation {
  status?: string; 
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

  if (!channel) await fail(ctx, `expectChannelState: channel ${channelId.slice(0, 12)}… not found`);
  if (expected.status !== undefined && channel!.state.state_name !== expected.status) {
    await fail(ctx, `expectChannelState: state "${channel!.state.state_name}" != expected "${expected.status}"`);
  }
  if (expected.capacity !== undefined) {
    const balances = BigInt(channel!.local_balance) + BigInt(channel!.remote_balance);
    const capacity = Number(balances / SHANNON_PER_CKB) + MIN_CHANNEL_RESERVE_CKB;
    if (capacity !== expected.capacity) {
      await fail(ctx, `expectChannelState: capacity ${capacity} CKB != expected ${expected.capacity} CKB`);
    }
  }
}
