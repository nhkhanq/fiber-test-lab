import type { z } from "zod";
import { loadConfig } from "../lib/config";
import { MIN_CHANNEL_RESERVE_CKB, SHANNON_PER_CKB } from "../lib/constants";
import { runLogPath } from "../lib/runlog/store";
import { evaluatePayment, type CheckResult, type PaymentResult } from "../lib/scenario/assertions";
import { classifyFailure, mapError } from "../lib/scenario/errorCategory";
import {
  BalanceCheckSchema,
  type AmountMatcher,
  type Asset,
  type ErrorCategory,
  type InvoiceStatus,
} from "../lib/scenario/schema";
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

async function assertChecks(ctx: ScenarioContext, name: string, checks: CheckResult[]): Promise<void> {
  const failed = checks.filter((c) => !c.match);
  if (failed.length === 0) return;
  await fail(ctx, `${name}: ${failed.map((c) => `${c.check} expected ${c.expected} but got ${c.actual}`).join("; ")}`);
}

export async function expectBalance(ctx: ScenarioContext, check: z.input<typeof BalanceCheckSchema>): Promise<void> {
  const parsed = BalanceCheckSchema.parse(check);
  await assertChecks(ctx, "expectBalance", await ctx.runtime.checkState({ balances: [parsed] }));
}

export async function expectOnchainCapacity(ctx: ScenarioContext, node: string, capacity: AmountMatcher): Promise<void> {
  await assertChecks(ctx, "expectOnchainCapacity", await ctx.runtime.checkState({ onchain: [{ node, capacity }] }));
}

export async function expectFee(
  ctx: ScenarioContext,
  fee: AmountMatcher,
  paymentId: string | null = ctx.lastPaymentId,
): Promise<void> {
  if (!paymentId) await fail(ctx, `expectFee: no payment to check (run ${ctx.runId})`);
  const step = ctx.store.data.steps.find(
    (s) => s.action === "send_payment" && (s.result as { payment_hash?: string } | null)?.payment_hash === paymentId,
  );
  const asset = (step?.input as { asset?: Asset } | null)?.asset ?? "CKB";
  const payment = await pollPayment(ctx, payerFor(ctx, paymentId!), paymentId!);
  await assertChecks(ctx, "expectFee", evaluatePayment({ fee }, payment as PaymentResult, asset));
}

export async function expectInvoiceStatus(
  ctx: ScenarioContext,
  invoice: { node: string; paymentHash: string },
  status: InvoiceStatus,
): Promise<void> {
  const config = loadConfig();
  const deadline = Date.now() + config.pollTimeoutMs;
  let actual = await ctx.runtime.invoiceStatus(invoice.node, invoice.paymentHash);
  while (actual !== status && Date.now() < deadline) {
    await sleep(config.pollIntervalMs);
    actual = await ctx.runtime.invoiceStatus(invoice.node, invoice.paymentHash);
  }
  if (actual !== status) await fail(ctx, `expectInvoiceStatus: status "${actual}" != expected "${status}"`);
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
