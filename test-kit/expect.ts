import { loadConfig } from "../lib/config";
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
