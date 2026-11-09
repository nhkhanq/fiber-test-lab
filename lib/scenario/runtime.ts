import { randomBytes } from "node:crypto";
import type { CkbChain, GenesisFacts, LockScript } from "../ckb/chain";
import type { GlobalConfig } from "../config";
import { DEV_FUNDED_KEYS, UDT_ASSET } from "../constants";
import { killNode, startNode } from "../docker/orchestrator";
import { toBaseUnits, toHex } from "../fiber/amounts";
import type { FiberClient } from "../fiber/client";
import { mintUdt, type UdtScript } from "../fiber/udt";
import type { ChannelSnapshot, RunLogStore, StepCheck, StepHandle } from "../runlog/store";
import { containerName } from "../../topology/compose.template";
import {
  evaluateBalances,
  evaluateChannels,
  evaluateInvoices,
  evaluateOnchain,
  evaluatePayment,
  needsBeforeState,
  type CheckResult,
  type PaymentResult,
} from "./assertions";
import { classifyFailure } from "./errorCategory";
import type { Asset, ErrorCategory, InvoiceStatus, Scenario, SeedStep, StepExpectation } from "./schema";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ChannelRequest {
  from: string;
  to: string;
  capacity: number;
  asset?: Asset;
}

export interface OpenedChannel {
  channelId: string;
}

export interface PaymentRequest {
  from: string;
  to: string;
  amount: number;
  asset?: Asset;
  /** Pay this encoded invoice instead of sending a keysend. */
  invoice?: string;
  /** Extra `send_payment` params, passed through as-is (e.g. max_fee_amount). */
  params?: Record<string, unknown>;
}

export interface PaymentOutcome {
  paymentHash: string | null;
  succeeded: boolean;
  /** Raw FNN status; null when the payment was rejected before it got a hash. */
  status: string | null;
  fee: bigint | null;
  error: string | null;
  reason: ErrorCategory | null;
  result: unknown;
}

export interface InvoiceRequest {
  to: string;
  amount: number;
  asset?: Asset;
  expiresInSec?: number;
}

export interface CreatedInvoice {
  node: string;
  address: string;
  paymentHash: string;
  amount: number;
  asset: Asset;
}

interface ResolvedNode {
  pubkey: string;
  address: string;
  lock: LockScript;
}

interface RawChannel {
  channel_id: string;
  pubkey?: string;
  peer_id?: string;
  state: { state_name: string };
  local_balance?: string;
  remote_balance?: string;
  funding_udt_type_script?: unknown;
}

interface StatePoint {
  channels: ChannelSnapshot[];
  onchain: Record<string, bigint>;
}

export interface RuntimeDeps {
  scenario: Scenario;
  client: FiberClient;
  chain: CkbChain;
  genesis: GenesisFacts;
  store: RunLogStore;
  config: GlobalConfig;
  runId: string;
}

function hexToDecimal(value: string | undefined): string | null {
  if (value === undefined || value === null) return null;
  try {
    return BigInt(value).toString();
  } catch {
    return null;
  }
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Everything a scenario can do to a running cluster. The YAML seeder and the test-kit both go
 *  through here, so a step means the same thing in either and always lands in the run-log. */
export class ScenarioRuntime {
  readonly #scenario: Scenario;
  readonly #client: FiberClient;
  readonly #chain: CkbChain;
  readonly #genesis: GenesisFacts;
  readonly #store: RunLogStore;
  readonly #config: GlobalConfig;
  readonly #runId: string;

  #nodes: Record<string, ResolvedNode> = {};
  readonly #channels: { from: string; to: string }[];
  readonly #udtByNode = new Map<string, UdtScript>();
  readonly #lastInvoice = new Map<string, CreatedInvoice>();

  constructor(deps: RuntimeDeps) {
    this.#scenario = deps.scenario;
    this.#client = deps.client;
    this.#chain = deps.chain;
    this.#genesis = deps.genesis;
    this.#store = deps.store;
    this.#config = deps.config;
    this.#runId = deps.runId;
    this.#channels = deps.scenario.channels.map(({ from, to }) => ({ from, to }));
  }

  get chain(): CkbChain {
    return this.#chain;
  }

  /** Learn each node's identity, and any UDT an earlier `up` minted (for `fiber-lab seed`). */
  async init(): Promise<void> {
    for (const node of this.#scenario.nodes) {
      const info = (await this.#client.rawCall(node, "node_info")) as {
        pubkey: string;
        addresses: string[];
        default_funding_lock_script: LockScript;
      };
      // Prefer /dns4/<node>/... (resolves via docker DNS) — addresses[0] is often 0.0.0.0, which isn't dial-able.
      const address = info.addresses.find((a) => a.startsWith("/dns4/")) ?? info.addresses[0] ?? "";
      this.#nodes[node] = { pubkey: info.pubkey, address, lock: info.default_funding_lock_script };
    }
    for (const step of this.#store.data.steps) {
      if (step.action !== "mint_udt") continue;
      const node = (step.input as { node?: string } | null)?.node;
      const script = (step.result as { script?: UdtScript } | null)?.script;
      if (node !== undefined && script !== undefined) this.#udtByNode.set(node, script);
    }
  }

  #node(name: string): ResolvedNode {
    const node = this.#nodes[name];
    if (node === undefined) throw new Error(`Unknown node "${name}" (have: ${Object.keys(this.#nodes).join(", ")})`);
    return node;
  }

  get #probeOptions() {
    return { timeoutMs: this.#config.pollTimeoutMs, probeIntervalMs: this.#config.pollIntervalMs };
  }

  async #poll<T>(probe: () => Promise<T | null>, label: string): Promise<T> {
    const deadline = Date.now() + this.#config.pollTimeoutMs;
    while (true) {
      const value = await probe();
      if (value !== null) return value;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
      await sleep(this.#config.pollIntervalMs);
    }
  }

  async #isConnected(node: string, peer: string): Promise<boolean> {
    const want = this.#node(peer).pubkey.toLowerCase();
    const res = (await this.#client.rawCall(node, "list_peers")) as { peers: { pubkey?: string }[] };
    return res.peers.some((p) => p.pubkey?.toLowerCase() === want);
  }

  async #listChannels(node: string): Promise<RawChannel[]> {
    const res = (await this.#client.rawCall(node, "list_channels", [{}])) as { channels: RawChannel[] };
    return res.channels;
  }

  #channelsWithPeer(channels: RawChannel[], peer: string): RawChannel[] {
    const want = this.#node(peer).pubkey.toLowerCase();
    return channels.filter((c) => (c.pubkey ?? c.peer_id)?.toLowerCase() === want);
  }

  /** Every node's view of its channels. Never throws: a node may be down on purpose. */
  async channelSnapshots(): Promise<ChannelSnapshot[]> {
    const nameByPubkey = new Map(Object.entries(this.#nodes).map(([name, r]) => [r.pubkey.toLowerCase(), name]));
    const snapshots: ChannelSnapshot[] = [];
    for (const node of Object.keys(this.#nodes)) {
      const channels = await this.#listChannels(node).catch(() => [] as RawChannel[]);
      for (const ch of channels) {
        snapshots.push({
          node,
          peer: nameByPubkey.get((ch.pubkey ?? ch.peer_id ?? "").toLowerCase()) ?? null,
          channelId: ch.channel_id,
          state: ch.state.state_name,
          asset: ch.funding_udt_type_script ? UDT_ASSET : "CKB",
          localBalance: hexToDecimal(ch.local_balance),
          remoteBalance: hexToDecimal(ch.remote_balance),
        });
      }
    }
    return snapshots;
  }

  async #udtFor(node: string, capacity: number): Promise<UdtScript> {
    const existing = this.#udtByNode.get(node);
    if (existing !== undefined) return existing;
    const key = DEV_FUNDED_KEYS[this.#scenario.nodes.indexOf(node)]!;
    const { script, txHash } = await mintUdt({
      chain: this.#chain,
      genesis: this.#genesis,
      minterPrivKey: key,
      amount: BigInt(capacity) * 100n, // 100x the funding amount, as headroom
      ...this.#probeOptions,
    });
    this.#udtByNode.set(node, script);
    this.#store.recordStep("mint_udt", { node, amount: capacity * 100, asset: UDT_ASSET }, { script, txHash });
    return script;
  }

  /** The UDT a node minted, or — if it minted none — the one script minted in this run. */
  #udtScript(node: string): UdtScript | undefined {
    return this.#udtByNode.get(node) ?? [...this.#udtByNode.values()][0];
  }

  async #open(request: ChannelRequest): Promise<OpenedChannel> {
    const asset = request.asset ?? "CKB";
    const { from, to, capacity } = request;
    const udt = asset === UDT_ASSET ? await this.#udtFor(from, capacity) : undefined;
    const peer = this.#node(to);

    // Opening a channel takes several seconds across four stages; report each as it happens so
    // `fiber-lab ui` shows where the run currently is.
    const step = this.#store.beginStep("open_channel", { from, to, capacity, asset });
    try {
      step.update({ stage: "connecting to peer" });
      await this.#client.connectPeer(from, { address: peer.address });
      await this.#poll(async () => ((await this.#isConnected(from, to)) ? true : null), `${from} to connect to ${to}`);

      const known = new Set(this.#channelsWithPeer(await this.#listChannels(from), to).map((c) => c.channel_id));

      step.update({ stage: "opening channel" });
      await this.#sendOpenChannel(from, peer.pubkey, toHex(toBaseUnits(capacity, asset)), udt);

      step.update({ stage: "waiting for ChannelReady" });
      const channelId = await this.#chain.mineUntil(() => this.#findReadyChannel(from, to, known), {
        label: `the ${from}->${to} channel to reach ChannelReady`,
        ...this.#probeOptions,
      });
      step.end({ ready: true, channelId }, await this.channelSnapshots());
      return { channelId };
    } catch (error) {
      step.end({ error: messageOf(error) });
      throw error;
    }
  }

  async #sendOpenChannel(from: string, pubkey: string, fundingAmount: string, udt: UdtScript | undefined): Promise<void> {
    const params: Record<string, unknown> = { pubkey, funding_amount: fundingAmount };
    if (udt) params.funding_udt_type_script = udt;
    const deadline = Date.now() + this.#config.pollTimeoutMs;
    while (true) {
      try {
        await this.#client.rawCall(from, "open_channel", [params]);
        return;
      } catch (error) {
        if (Date.now() < deadline && /waiting for peer|Init|feature not found/i.test(messageOf(error))) {
          await sleep(this.#config.pollIntervalMs);
          continue;
        }
        throw error;
      }
    }
  }

  /** A channel not in `known` that BOTH sides consider ready. A node can be ChannelReady a moment
   *  before its peer, and a payment sent in that gap fails for a reason no test intended. */
  async #findReadyChannel(from: string, to: string, known: Set<string>): Promise<string | null> {
    const opened = this.#channelsWithPeer(await this.#listChannels(from), to).find(
      (c) => !known.has(c.channel_id) && c.state.state_name === "ChannelReady",
    );
    if (opened === undefined) return null;
    const remote = (await this.#listChannels(to)).find((c) => c.channel_id === opened.channel_id);
    return remote?.state.state_name === "ChannelReady" ? opened.channel_id : null;
  }

  /** Open the scenario's declared channels (`fiber-lab up`). */
  async openDeclaredChannels(): Promise<void> {
    for (const channel of this.#scenario.channels) await this.#open(channel);
  }

  /** Open a channel the scenario did not declare. */
  async openChannel(request: ChannelRequest): Promise<OpenedChannel> {
    const opened = await this.#open(request);
    this.#channels.push({ from: request.from, to: request.to });
    return opened;
  }

  #neighbours(node: string): string[] {
    return this.#channels.flatMap((c) => (c.from === node ? [c.to] : c.to === node ? [c.from] : []));
  }

  /** How many channels are reachable from `node` in the topology the lab built. */
  #reachableChannelCount(node: string): number {
    const seen = new Set([node]);
    const queue = [node];
    while (queue.length > 0) {
      for (const next of this.#neighbours(queue.shift()!)) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return this.#channels.filter((c) => seen.has(c.from) && seen.has(c.to)).length;
  }

  /** Wait for gossip to tell `from` about every channel it could route over. Checking only for
   *  the target's channel is not enough once a route has more than one intermediary. Soft on
   *  purpose: a route that never appears is what a no-route scenario is testing. */
  async #waitForGraph(from: string): Promise<void> {
    const expected = this.#reachableChannelCount(from);
    const deadline = Date.now() + this.#config.pollTimeoutMs;
    while (Date.now() < deadline) {
      const res = (await this.#client.rawCall(from, "graph_channels", [{}])) as { channels: unknown[] };
      if (res.channels.length >= expected) return;
      await sleep(this.#config.pollIntervalMs);
    }
  }

  async #waitPayment(node: string, paymentHash: string): Promise<PaymentResult> {
    return this.#poll(async () => {
      const payment = (await this.#client.rawCall(node, "get_payment", [{ payment_hash: paymentHash }])) as PaymentResult;
      return payment.status === "Success" || payment.status === "Failed" ? payment : null;
    }, `payment ${paymentHash.slice(0, 12)}… to finish`);
  }

  /** Whether the payer can still reach the network: its channel to the target if it has one,
   *  otherwise any of its channel peers. */
  async #peerConnected(from: string, to: string): Promise<boolean> {
    const neighbours = this.#neighbours(from);
    const relevant = neighbours.includes(to) ? [to] : neighbours;
    if (relevant.length === 0) return true;
    const states = await Promise.all(relevant.map((peer) => this.#isConnected(from, peer).catch(() => true)));
    return states.some(Boolean);
  }

  async #sendPayment(request: PaymentRequest, record: StepHandle): Promise<PaymentResult> {
    const asset = request.asset ?? "CKB";
    const { from, to, amount } = request;
    try {
      let params: Record<string, unknown>;
      if (request.invoice !== undefined) {
        params = { invoice: request.invoice };
      } else {
        await this.#waitForGraph(from);
        params = { target_pubkey: this.#node(to).pubkey, amount: toHex(toBaseUnits(amount, asset)), keysend: true };
        if (asset === UDT_ASSET) params.udt_type_script = this.#udtScript(from);
      }
      // send_payment can fail synchronously (insufficient outbound / expired invoice) — record it, don't throw.
      const res = (await this.#client.rawCall(from, "send_payment", [{ ...params, ...request.params }])) as {
        payment_hash: string;
      };
      record.update({ payment_hash: res.payment_hash, status: "Inflight" });
      const final = await this.#waitPayment(from, res.payment_hash);
      const result: PaymentResult =
        final.status === "Failed" ? { ...final, peerConnected: await this.#peerConnected(from, to) } : final;
      record.end(result, await this.channelSnapshots());
      return result;
    } catch (error) {
      const result: PaymentResult = { error: messageOf(error), peerConnected: await this.#peerConnected(from, to) };
      record.end(result, await this.channelSnapshots());
      return result;
    }
  }

  #beginPayment(request: PaymentRequest): StepHandle {
    const { from, to, amount } = request;
    return this.#store.beginStep("send_payment", { from, to, amount, asset: request.asset ?? "CKB" });
  }

  async pay(request: PaymentRequest): Promise<PaymentOutcome> {
    const result = await this.#sendPayment(request, this.#beginPayment(request));
    const raw = result as PaymentResult & { payment_hash?: string };
    return {
      paymentHash: raw.payment_hash ?? null,
      succeeded: raw.status === "Success",
      status: raw.status ?? null,
      fee: typeof raw.fee === "string" ? BigInt(raw.fee) : null,
      error: raw.error === undefined ? ((raw.failed_error as string | null | undefined) ?? null) : String(raw.error),
      reason: raw.status === "Success" ? null : classifyFailure(raw),
      result,
    };
  }

  async newInvoice(request: InvoiceRequest): Promise<CreatedInvoice> {
    const asset = request.asset ?? "CKB";
    const { to, amount, expiresInSec } = request;
    const step = this.#store.beginStep("new_invoice", { to, amount, asset });
    try {
      const params: Record<string, unknown> = {
        amount: toHex(toBaseUnits(amount, asset)),
        currency: "Fibd",
        payment_preimage: `0x${randomBytes(32).toString("hex")}`,
        description: `${this.#scenario.name}:${to}`,
      };
      if (expiresInSec !== undefined) params.expiry = `0x${expiresInSec.toString(16)}`;
      if (asset === UDT_ASSET) params.udt_type_script = this.#udtScript(to);

      const res = (await this.#client.rawCall(to, "new_invoice", [params])) as {
        invoice_address: string;
        invoice: { data: { payment_hash: string } };
      };
      const invoice: CreatedInvoice = {
        node: to,
        address: res.invoice_address,
        paymentHash: res.invoice.data.payment_hash,
        amount,
        asset,
      };
      this.#lastInvoice.set(to, invoice);
      step.end(res);
      return invoice;
    } catch (error) {
      step.end({ error: messageOf(error) });
      throw error;
    }
  }

  async invoiceStatus(node: string, paymentHash: string): Promise<InvoiceStatus> {
    const res = (await this.#client.rawCall(node, "get_invoice", [{ payment_hash: paymentHash }])) as {
      status: InvoiceStatus;
    };
    return res.status;
  }

  async capacityOf(node: string): Promise<bigint> {
    return this.#chain.capacityOf(this.#node(node).lock);
  }

  async mine(blocks = 1): Promise<bigint> {
    const step = this.#store.beginStep("mine", { blocks });
    const tip = await this.#chain.mine(blocks);
    await this.#chain.syncIndexer();
    step.end({ tip: tip.toString() });
    return tip;
  }

  async advanceEpochs(epochs: number): Promise<bigint> {
    const step = this.#store.beginStep("advance_epochs", { epochs });
    const tip = await this.#chain.advanceEpochs(epochs);
    await this.#chain.syncIndexer();
    step.end({ tip: tip.toString() });
    return tip;
  }

  async killNode(node: string): Promise<void> {
    const step = this.#store.beginStep("kill_node", { node });
    const container = containerName(this.#config, this.#runId, node);
    await killNode(container);
    step.end({ container });
  }

  async startNode(node: string): Promise<void> {
    const step = this.#store.beginStep("start_node", { node });
    const container = containerName(this.#config, this.#runId, node);
    await startNode(container, this.#config);
    step.end({ container, ready: true });
  }

  async #statePoint(expect: StepExpectation): Promise<StatePoint> {
    const channels = expect.balances !== undefined || expect.channels !== undefined ? await this.channelSnapshots() : [];
    const onchain: Record<string, bigint> = {};
    for (const { node } of expect.onchain ?? []) onchain[node] ??= await this.capacityOf(node);
    return { channels, onchain };
  }

  async #invoiceStatuses(expect: StepExpectation): Promise<Record<string, InvoiceStatus | null>> {
    const statuses: Record<string, InvoiceStatus | null> = {};
    for (const { node } of expect.invoices ?? []) {
      const invoice = this.#lastInvoice.get(node);
      statuses[node] = invoice === undefined ? null : await this.invoiceStatus(node, invoice.paymentHash);
    }
    return statuses;
  }

  /** Evaluate the state part of an expectation, polling until it holds or the timeout runs out:
   *  balances settle a moment after a payment reports Success (BR-POL-003). */
  async checkState(expect: StepExpectation, before: StatePoint | null = null): Promise<CheckResult[]> {
    const deadline = Date.now() + this.#config.pollTimeoutMs;
    while (true) {
      const now = await this.#statePoint(expect);
      const results = [
        ...evaluateBalances(expect.balances ?? [], now.channels, before?.channels ?? null),
        ...evaluateChannels(expect.channels ?? [], now.channels),
        ...evaluateInvoices(expect.invoices ?? [], await this.#invoiceStatuses(expect)),
        ...evaluateOnchain(expect.onchain ?? [], now.onchain, before?.onchain ?? null),
      ];
      if (results.every((r) => r.match) || Date.now() > deadline) return results;
      await sleep(this.#config.pollIntervalMs);
    }
  }

  async #perform(step: SeedStep): Promise<{ handle?: StepHandle; result: PaymentResult | null }> {
    switch (step.action) {
      case "send_payment": {
        const request: PaymentRequest = { from: step.from!, to: step.to!, amount: step.amount!, asset: step.asset };
        const handle = this.#beginPayment(request);
        if (step.useInvoice) {
          const invoice = this.#lastInvoice.get(step.to!);
          if (invoice === undefined) {
            const result: PaymentResult = { error: `send_payment useInvoice: no invoice for "${step.to}"` };
            handle.end(result, await this.channelSnapshots());
            return { handle, result };
          }
          request.invoice = invoice.address;
        }
        return { handle, result: await this.#sendPayment(request, handle) };
      }
      case "new_invoice":
        await this.newInvoice({ to: step.to!, amount: step.amount!, asset: step.asset, expiresInSec: step.expiresInSec });
        return { result: null };
      case "wait":
        await sleep(step.durationSec! * 1000);
        this.#store.recordStep("wait", { durationSec: step.durationSec });
        return { result: null };
      case "kill_node":
        await this.killNode(step.node!);
        return { result: null };
      case "start_node":
        await this.startNode(step.node!);
        return { result: null };
      case "mine":
        await this.mine(step.blocks ?? 1);
        return { result: null };
      case "advance_epochs":
        await this.advanceEpochs(step.epochs!);
        return { result: null };
      case "assert":
        return { handle: this.#store.beginStep("assert", step.expect), result: null };
    }
  }

  /** Run one seed step and, if it declares `expect`, record what it found on the step itself. */
  async runStep(step: SeedStep): Promise<StepCheck[]> {
    const expect = step.expect;
    const before = expect !== undefined && needsBeforeState(expect) ? await this.#statePoint(expect) : null;
    const { handle, result } = await this.#perform(step);
    if (expect === undefined) return [];

    const checks = [
      ...(step.action === "send_payment" ? evaluatePayment(expect, result, step.asset ?? "CKB") : []),
      ...(await this.checkState(expect, before)),
    ];
    if (handle === undefined) this.#store.checkLastStep(checks);
    else handle.check(checks);
    if (step.action === "assert") handle?.end({ match: checks.every((c) => c.match) }, await this.channelSnapshots());
    return checks;
  }

  async runSeedSteps(): Promise<void> {
    for (const step of this.#scenario.seed) await this.runStep(step);
  }

  /** Repeat the seed's actions without its expectations, which describe the first run: a balance
   *  that was right the first time cannot be right after the same payment is sent again. */
  async repeatSeedSteps(): Promise<void> {
    for (const step of this.#scenario.seed) {
      if (step.action !== "assert") await this.runStep({ ...step, expect: undefined });
    }
  }
}
