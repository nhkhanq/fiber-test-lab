import { loadConfig } from "../lib/config";
import { reset as resetRun } from "../lib/docker/orchestrator";
import { FiberClient } from "../lib/fiber/client";
import { subscribePayments, type PaymentWatcher } from "../lib/fiber/subscribe";
import type { RunLogStore, StepRecord } from "../lib/runlog/store";
import { runScenario } from "../lib/scenario/run";
import type {
  ChannelRequest,
  CreatedInvoice,
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
export type OpenChannelOptions = Omit<ChannelRequest, "from" | "to" | "capacity">;

export interface ChannelBalances {
  local: bigint;
  remote: bigint;
}

export interface ScenarioContext {
  runId: string;
  network: string;
  scenario: Scenario;
  expectation: ExpectationResult | null;
  store: RunLogStore;
  endpoints: Record<string, string>;
  ckbEndpoint: string;
  runtime: ScenarioRuntime;
  readonly lastPaymentId: string | null;
  readonly lastPaymentFrom: string | null;
  call(node: string, method: string, params?: unknown[]): Promise<unknown>;
  watchPayments(node: string): Promise<PaymentWatcher>;
  pay(from: string, to: string, amount: number, options?: PayOptions): Promise<PaymentOutcome>;
  payInvoice(from: string, invoice: CreatedInvoice, options?: PayOptions): Promise<PaymentOutcome>;
  newInvoice(to: string, amount: number, options?: InvoiceOptions): Promise<CreatedInvoice>;
  openChannel(from: string, to: string, capacity: number, options?: OpenChannelOptions): Promise<OpenedChannel>;
  killNode(node: string): Promise<void>;
  startNode(node: string): Promise<void>;
  mine(blocks?: number): Promise<bigint>;
  advanceEpochs(epochs: number): Promise<bigint>;
  balances(node: string, options?: { peer?: string; asset?: Asset }): Promise<ChannelBalances>;
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
    newInvoice: (to, amount, opts = {}) => runtime.newInvoice({ to, amount, ...opts }),
    openChannel: (from, to, capacity, opts = {}) => runtime.openChannel({ from, to, capacity, ...opts }),
    killNode: (node) => runtime.killNode(node),
    startNode: (node) => runtime.startNode(node),
    mine: (blocks = 1) => runtime.mine(blocks),
    advanceEpochs: (epochs) => runtime.advanceEpochs(epochs),
    balances: async (node, { peer, asset = "CKB" } = {}) => {
      const channels = (await runtime.channelSnapshots()).filter(
        (c) => c.node === node && c.asset === asset && (peer === undefined || c.peer === peer),
      );
      return channels.reduce<ChannelBalances>(
        (sum, c) => ({
          local: sum.local + BigInt(c.localBalance ?? 0),
          remote: sum.remote + BigInt(c.remoteBalance ?? 0),
        }),
        { local: 0n, remote: 0n },
      );
    },
    onchainCapacity: (node) => runtime.capacityOf(node),
    reset: async () => {
      await store.save();
      await resetRun(up.runId, config);
    },
  };
}
