import { loadConfig } from "../lib/config";
import { reset as resetRun } from "../lib/docker/orchestrator";
import { FiberClient } from "../lib/fiber/client";
import { subscribePayments, type PaymentWatcher } from "../lib/fiber/subscribe";
import type { RunLogStore, StepRecord } from "../lib/runlog/store";
import { runScenario } from "../lib/scenario/run";
import type {
  ChannelRequest,
  ClosedChannel,
  CreatedInvoice,
  InvoiceActionResult,
  InvoiceRequest,
  OpenedChannel,
  PaymentOutcome,
  PaymentRequest,
  ScenarioRuntime,
} from "../lib/scenario/runtime";
import type { Asset, Scenario, ScenarioInput } from "../lib/scenario/schema";
import type { ExpectationResult } from "../lib/scenario/verify";

export type PayOptions = Omit<PaymentRequest, "from" | "to" | "amount">;
export type InvoiceOptions = Omit<InvoiceRequest, "to" | "amount">;
export type HoldInvoiceOptions = Omit<InvoiceOptions, "hold">;
export type OpenChannelOptions = Omit<ChannelRequest, "from" | "to" | "capacity">;

export interface ChannelBalances {
  /** Base units (shannon for CKB), summed across the matching open channels. */
  local: bigint;
  remote: bigint;
  /** Locked in unsettled TLCs: `local` does not drop until a held payment settles. */
  offered: bigint;
  received: bigint;
}

export interface ScenarioContext {
  runId: string;
  network: string;
  scenario: Scenario;
  expectation: ExpectationResult | null;
  store: RunLogStore;
  /** Kept current: a restarted node gets a new host port. */
  endpoints: Record<string, string>;
  ckbEndpoint: string;
  runtime: ScenarioRuntime;
  /** The most recent send_payment in this run, however it was made. */
  readonly lastPaymentId: string | null;
  readonly lastPaymentFrom: string | null;
  call(node: string, method: string, params?: unknown[]): Promise<unknown>;
  watchPayments(node: string): Promise<PaymentWatcher>;
  /** Send a keysend payment and wait for it. Never throws for a payment outcome: read `state`. */
  pay(from: string, to: string, amount: number, options?: PayOptions): Promise<PaymentOutcome>;
  payInvoice(from: string, invoice: CreatedInvoice, options?: PayOptions): Promise<PaymentOutcome>;
  /** Wait for a payment left in flight, or one whose earlier wait timed out, to finish. */
  awaitPayment(outcome: PaymentOutcome, options?: { timeoutMs?: number }): Promise<PaymentOutcome>;
  newInvoice(to: string, amount: number, options?: InvoiceOptions): Promise<CreatedInvoice>;
  /** An invoice whose payment waits, locked, until settleInvoice or cancelInvoice. */
  newHoldInvoice(to: string, amount: number, options?: HoldInvoiceOptions): Promise<CreatedInvoice>;
  /** A refusal resolves with `{ ok: false, error }` so a test can assert on it. */
  settleInvoice(invoice: CreatedInvoice, options?: { preimage?: string }): Promise<InvoiceActionResult>;
  cancelInvoice(invoice: CreatedInvoice): Promise<InvoiceActionResult>;
  /** Open a channel the scenario did not declare and wait until both sides report it ready. */
  openChannel(from: string, to: string, capacity: number, options?: OpenChannelOptions): Promise<OpenedChannel>;
  /** Close a channel, mining until it is closed. A forced close is only waited for on `from`. */
  closeChannel(from: string, to: string, options?: { force?: boolean }): Promise<ClosedChannel>;
  disconnectPeer(from: string, to: string): Promise<void>;
  connectPeer(from: string, to: string): Promise<void>;
  killNode(node: string): Promise<void>;
  startNode(node: string): Promise<void>;
  /** Freeze a node: it keeps its connections and answers nothing. */
  pauseNode(node: string): Promise<void>;
  resumeNode(node: string): Promise<void>;
  /** Mine blocks; returns the new tip. In the default manual mode nothing else moves the chain. */
  mine(blocks?: number): Promise<bigint>;
  advanceEpochs(epochs: number): Promise<bigint>;
  balances(node: string, options?: { peer?: string; asset?: Asset }): Promise<ChannelBalances>;
  /** What the node's default lock owns on-chain, in shannon. */
  onchainCapacity(node: string): Promise<bigint>;
  reset(): Promise<void>;
}

function lastSendPayment(store: RunLogStore): StepRecord | undefined {
  return [...store.data.steps].reverse().find((s) => s.action === "send_payment");
}

export async function setupScenario(
  input: string | ScenarioInput,
  options: { keep?: boolean } = {},
): Promise<ScenarioContext> {
  const config = loadConfig();
  const { scenario, up, store, runtime, expectation } = await runScenario(input, config, options);
  const client = new FiberClient({ endpoints: up.endpoints, logger: store.recordRpc });

  return {
    runId: up.runId,
    network: up.network,
    scenario,
    expectation,
    store,
    endpoints: up.endpoints,
    ckbEndpoint: up.ckbEndpoint,
    runtime,
    get lastPaymentId() {
      return (lastSendPayment(store)?.result as { payment_hash?: string } | null)?.payment_hash ?? null;
    },
    get lastPaymentFrom() {
      return (lastSendPayment(store)?.input as { from?: string } | null)?.from ?? null;
    },
    call: (node, method, params = []) => client.rawCall(node, method, params),
    watchPayments: (node) => subscribePayments(up.endpoints[node]!, config),
    pay: (from, to, amount, opts = {}) => runtime.pay({ from, to, amount, ...opts }),
    payInvoice: (from, invoice, opts = {}) =>
      runtime.pay({
        from,
        to: invoice.node,
        amount: invoice.amount,
        asset: invoice.asset,
        invoice: invoice.address,
        ...opts,
      }),
    awaitPayment: (outcome, opts = {}) => runtime.awaitPayment(outcome, opts),
    newInvoice: (to, amount, opts = {}) => runtime.newInvoice({ to, amount, ...opts }),
    newHoldInvoice: (to, amount, opts = {}) => runtime.newInvoice({ to, amount, ...opts, hold: true }),
    settleInvoice: (invoice, opts = {}) => runtime.settleInvoice(invoice, opts),
    cancelInvoice: (invoice) => runtime.cancelInvoice(invoice),
    openChannel: (from, to, capacity, opts = {}) => runtime.openChannel({ from, to, capacity, ...opts }),
    closeChannel: (from, to, opts = {}) => runtime.closeChannel({ from, to, ...opts }),
    disconnectPeer: (from, to) => runtime.disconnectPeer(from, to),
    connectPeer: (from, to) => runtime.connectPeer(from, to),
    killNode: (node) => runtime.killNode(node),
    startNode: (node) => runtime.startNode(node),
    pauseNode: (node) => runtime.pauseNode(node),
    resumeNode: (node) => runtime.resumeNode(node),
    mine: (blocks = 1) => runtime.mine(blocks),
    advanceEpochs: (epochs) => runtime.advanceEpochs(epochs),
    balances: async (node, { peer, asset = "CKB" } = {}) => {
      const channels = (await runtime.channelSnapshots()).filter(
        (c) => c.node === node && c.asset === asset && c.state !== "Closed" && (peer === undefined || c.peer === peer),
      );
      return channels.reduce<ChannelBalances>(
        (sum, c) => ({
          local: sum.local + BigInt(c.localBalance ?? 0),
          remote: sum.remote + BigInt(c.remoteBalance ?? 0),
          offered: sum.offered + BigInt(c.offeredBalance ?? 0),
          received: sum.received + BigInt(c.receivedBalance ?? 0),
        }),
        { local: 0n, remote: 0n, offered: 0n, received: 0n },
      );
    },
    onchainCapacity: (node) => runtime.capacityOf(node),
    reset: async () => {
      // Flush first: a write still pending after the reset would restore the old status.
      await store.save();
      await resetRun(up.runId, config);
    },
  };
}
