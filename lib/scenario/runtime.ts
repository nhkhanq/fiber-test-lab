import { randomBytes } from "node:crypto";
import { ccc } from "@ckb-ccc/core";
import type { CkbChain, GenesisFacts, LockScript } from "../ckb/chain";
import type { GlobalConfig } from "../config";
import { DEV_FUNDED_KEYS, UDT_ASSET } from "../constants";
import { killNode, pauseNode, resumeNode, startNode } from "../docker/orchestrator";
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
  evaluatePeers,
  evaluateRefusal,
  needsBeforeState,
  paymentState,
  type CheckResult,
  type PaymentResult,
} from "./assertions";
import { classifyFailure } from "./errorCategory";
import {
  PAYMENT_ACTIONS,
  REFUSABLE_ACTIONS,
  type Asset,
  type ErrorCategory,
  type InvoiceStatus,
  type PaymentState,
  type Scenario,
  type SeedStep,
  type StepExpectation,
} from "./schema";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CLOSE_FEE_RATE = "0x3FC"; // shannons per KW, the rate FNN's own e2e suite closes with
const WRONG_PREIMAGE = `0x${"11".repeat(32)}`;

export interface ChannelRequest {
  from: string;
  to: string;
  capacity: number;
  asset?: Asset;
}

export interface OpenedChannel {
  channelId: string;
}

export interface CloseRequest {
  from: string;
  to: string;
  force?: boolean;
}

export interface ClosedChannel {
  ok: boolean;
  error: string | null;
  channelId: string | null;
  flags: string | null;
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
  /** "inflight" returns as soon as the payment is on its way, for a payment that is meant to wait. */
  waitFor?: "final" | "inflight";
  timeoutMs?: number;
}

export interface PaymentOutcome {
  from: string;
  to: string;
  paymentHash: string | null;
  /** succeeded, failed, inflight (left waiting on purpose) or timeout (stopped watching; not a failure). */
  state: PaymentState;
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
  /** The payment waits, locked, until settle_invoice or cancel_invoice. */
  hold?: boolean;
  /** Hold against this hash, for a flow where the payer created the secret. Implies hold. */
  paymentHash?: string;
  finalExpiryDeltaSec?: number;
  /** Extra `new_invoice` params, passed through as-is. */
  params?: Record<string, unknown>;
}

export interface CreatedInvoice {
  node: string;
  address: string;
  paymentHash: string;
  amount: number;
  asset: Asset;
  hold: boolean;
  /** Null when the invoice was held against a hash the lab did not create. */
  preimage: string | null;
}

export interface InvoiceActionResult {
  ok: boolean;
  error: string | null;
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
  state: { state_name: string; state_flags?: unknown };
  local_balance?: string;
  remote_balance?: string;
  offered_tlc_balance?: string;
  received_tlc_balance?: string;
  funding_udt_type_script?: unknown;
}

interface StatePoint {
  channels: ChannelSnapshot[];
  onchain: Record<string, bigint>;
}

interface TrackedPayment {
  hash: string;
  to: string;
  asset: Asset;
}

/** What a performed step produced. `error` marks a refusal the scenario can assert on. */
type StepResult = (PaymentResult & { error?: unknown }) | null;

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
  readonly #lastPayment = new Map<string, TrackedPayment>();
  /** Killed or paused on purpose. Querying a paused node would hang until the RPC timeout. */
  readonly #offline = new Set<string>();

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
    // A control command attaches to a run in whatever state the last one left it.
    for (const step of this.#store.data.steps) {
      const target = (step.input as { node?: string } | null)?.node;
      if (target === undefined) continue;
      if (step.action === "kill_node" || step.action === "pause_node") this.#offline.add(target);
      if (step.action === "start_node" || step.action === "resume_node") this.#offline.delete(target);
    }

    for (const node of this.#scenario.nodes) {
      const info = await this.#nodeInfo(node);
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

  /** A node that is down cannot be asked, so fall back on what it said when it was up. */
  async #nodeInfo(node: string): Promise<{ pubkey: string; addresses: string[]; default_funding_lock_script: LockScript }> {
    type Info = { pubkey: string; addresses: string[]; default_funding_lock_script: LockScript };
    if (!this.#offline.has(node)) return (await this.#client.rawCall(node, "node_info")) as Info;
    const logged = this.#store.data.rpcCalls.find((r) => r.node === node && r.method === "node_info" && r.response !== null);
    if (logged === undefined) throw new Error(`"${node}" is down and the run-log has no record of it`);
    return logged.response as Info;
  }

  #node(name: string): ResolvedNode {
    const node = this.#nodes[name];
    if (node === undefined) throw new Error(`Unknown node "${name}" (have: ${Object.keys(this.#nodes).join(", ")})`);
    return node;
  }

  #container(node: string): string {
    return containerName(this.#config, this.#runId, node);
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

  async #listChannels(node: string, includeClosed = false): Promise<RawChannel[]> {
    const params = includeClosed ? { include_closed: true } : {};
    const res = (await this.#client.rawCall(node, "list_channels", [params])) as { channels: RawChannel[] };
    return res.channels;
  }

  #channelsWithPeer(channels: RawChannel[], peer: string): RawChannel[] {
    const want = this.#node(peer).pubkey.toLowerCase();
    return channels.filter((c) => (c.pubkey ?? c.peer_id)?.toLowerCase() === want);
  }

  /** Every node's view of its channels, closed ones included. Never throws: a node may be down on purpose. */
  async channelSnapshots(): Promise<ChannelSnapshot[]> {
    const nameByPubkey = new Map(Object.entries(this.#nodes).map(([name, r]) => [r.pubkey.toLowerCase(), name]));
    const snapshots: ChannelSnapshot[] = [];
    for (const node of Object.keys(this.#nodes)) {
      if (this.#offline.has(node)) continue;
      const channels = await this.#listChannels(node, true).catch(() => [] as RawChannel[]);
      for (const ch of channels) {
        snapshots.push({
          node,
          peer: nameByPubkey.get((ch.pubkey ?? ch.peer_id ?? "").toLowerCase()) ?? null,
          channelId: ch.channel_id,
          state: ch.state.state_name,
          stateFlags: ch.state.state_flags === undefined ? null : String(ch.state.state_flags),
          asset: ch.funding_udt_type_script ? UDT_ASSET : "CKB",
          localBalance: hexToDecimal(ch.local_balance),
          remoteBalance: hexToDecimal(ch.remote_balance),
          offeredBalance: hexToDecimal(ch.offered_tlc_balance),
          receivedBalance: hexToDecimal(ch.received_tlc_balance),
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
      await this.#client.rawCall(from, "connect_peer", [{ address: peer.address }]);
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
    if (this.#scenario.channels.length === 0) return;
    // A client outside the lab sends its first payment the moment `up` returns.
    const step = this.#store.beginStep("graph_sync", { nodes: this.#scenario.nodes });
    for (const node of this.#scenario.nodes) await this.#waitForGraph(node);
    step.end({ synced: true });
  }

  /** Open a channel the scenario did not declare. */
  async openChannel(request: ChannelRequest): Promise<OpenedChannel> {
    const opened = await this.#open(request);
    this.#channels.push({ from: request.from, to: request.to });
    return opened;
  }

  #forgetChannel(a: string, b: string): void {
    const index = this.#channels.findIndex((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a));
    if (index !== -1) this.#channels.splice(index, 1);
  }

  async #closedFlags(node: string, channelId: string): Promise<string | null> {
    const channel = (await this.#listChannels(node, true)).find((c) => c.channel_id === channelId);
    return channel?.state.state_name === "Closed" ? String(channel.state.state_flags ?? "") : null;
  }

  async #close(request: CloseRequest): Promise<{ handle: StepHandle; result: ClosedChannel }> {
    const { from, to, force = false } = request;
    const handle = this.#store.beginStep("close_channel", { from, to, force });
    try {
      const channel = this.#channelsWithPeer(await this.#listChannels(from), to).find(
        (c) => c.state.state_name !== "Closed",
      );
      if (channel === undefined) throw new Error(`${from} has no open channel with ${to}`);
      const channelId = channel.channel_id;

      await this.#client.rawCall(from, "shutdown_channel", [
        force
          ? { channel_id: channelId, force: true }
          : { channel_id: channelId, close_script: this.#node(from).lock, fee_rate: CLOSE_FEE_RATE },
      ]);
      handle.update({ stage: "waiting for the close to confirm", channelId });

      // A force-close is one-sided: the peer only learns of it from the chain, later.
      const flags = await this.#chain.mineUntil(
        async () => {
          const initiator = await this.#closedFlags(from, channelId);
          if (initiator === null) return null;
          if (!force && (await this.#closedFlags(to, channelId)) === null) return null;
          return initiator;
        },
        { label: `the ${from}->${to} channel to close`, ...this.#probeOptions },
      );
      this.#forgetChannel(from, to);

      handle.end({ channelId, flags }, await this.channelSnapshots());
      return { handle, result: { ok: true, error: null, channelId, flags } };
    } catch (error) {
      const message = messageOf(error);
      handle.end({ error: message }, await this.channelSnapshots());
      return { handle, result: { ok: false, error: message, channelId: null, flags: null } };
    }
  }

  async closeChannel(request: CloseRequest): Promise<ClosedChannel> {
    return (await this.#close(request)).result;
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

  /** Watch a payment. Running out of time is an answer of its own: the payment may still settle,
   *  so it comes back marked timedOut with the last status seen, never as a failure. An RPC error
   *  is not an answer either: the payer may be down and come back. */
  async #watchPayment(
    node: string,
    paymentHash: string,
    until: "final" | "inflight",
    timeoutMs: number,
  ): Promise<PaymentResult> {
    const deadline = Date.now() + timeoutMs;
    let last: PaymentResult = { payment_hash: paymentHash };
    while (true) {
      try {
        last = (await this.#client.rawCall(node, "get_payment", [{ payment_hash: paymentHash }])) as PaymentResult;
        if (last.status === "Success" || last.status === "Failed") return last;
        if (until === "inflight" && last.status === "Inflight") return last;
      } catch {
        // Keep watching until the deadline.
      }
      if (Date.now() > deadline) return { ...last, payment_hash: paymentHash, timedOut: true };
      await sleep(this.#config.pollIntervalMs);
    }
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

  async #endPaymentStep(from: string, to: string, watched: PaymentResult, record: StepHandle): Promise<PaymentResult> {
    const result: PaymentResult =
      watched.status === "Failed" ? { ...watched, peerConnected: await this.#peerConnected(from, to) } : watched;
    record.end(result, await this.channelSnapshots());
    return result;
  }

  async #sendPayment(request: PaymentRequest, record: StepHandle): Promise<PaymentResult> {
    const asset = request.asset ?? "CKB";
    const { from, to, amount } = request;
    let paymentHash: string;
    try {
      await this.#waitForGraph(from);
      let params: Record<string, unknown>;
      if (request.invoice !== undefined) {
        params = { invoice: request.invoice };
      } else {
        params = { target_pubkey: this.#node(to).pubkey, amount: toHex(toBaseUnits(amount, asset)), keysend: true };
        if (asset === UDT_ASSET) params.udt_type_script = this.#udtScript(from);
      }
      // send_payment can fail synchronously (insufficient outbound / expired invoice) — record it, don't throw.
      const res = (await this.#client.rawCall(from, "send_payment", [{ ...params, ...request.params }])) as {
        payment_hash: string;
      };
      paymentHash = res.payment_hash;
    } catch (error) {
      const result: PaymentResult = { error: messageOf(error), peerConnected: await this.#peerConnected(from, to) };
      record.end(result, await this.channelSnapshots());
      return result;
    }

    record.update({ payment_hash: paymentHash, status: "Inflight" });
    this.#lastPayment.set(from, { hash: paymentHash, to, asset });
    const watched = await this.#watchPayment(
      from,
      paymentHash,
      request.waitFor ?? "final",
      request.timeoutMs ?? this.#config.pollTimeoutMs,
    );
    return this.#endPaymentStep(from, to, watched, record);
  }

  #beginPayment(request: PaymentRequest): StepHandle {
    const { from, to, amount } = request;
    return this.#store.beginStep("send_payment", { from, to, amount, asset: request.asset ?? "CKB" });
  }

  #outcome(from: string, to: string, result: PaymentResult): PaymentOutcome {
    const state = paymentState(result);
    return {
      from,
      to,
      paymentHash: result.payment_hash ?? null,
      state,
      succeeded: state === "succeeded",
      status: result.status ?? null,
      fee: typeof result.fee === "string" ? BigInt(result.fee) : null,
      error: result.error === undefined ? ((result.failed_error as string | null | undefined) ?? null) : String(result.error),
      reason: state === "failed" ? classifyFailure(result) : null,
      result,
    };
  }

  async pay(request: PaymentRequest): Promise<PaymentOutcome> {
    return this.#outcome(request.from, request.to, await this.#sendPayment(request, this.#beginPayment(request)));
  }

  async #awaitTracked(from: string, tracked: TrackedPayment | undefined, timeoutMs?: number): Promise<{ handle: StepHandle; result: PaymentResult }> {
    const handle = this.#store.beginStep("await_payment", { from, payment_hash: tracked?.hash ?? null });
    if (tracked === undefined) {
      const result: PaymentResult = { error: `await_payment: "${from}" has sent no payment` };
      handle.end(result, await this.channelSnapshots());
      return { handle, result };
    }
    const watched = await this.#watchPayment(from, tracked.hash, "final", timeoutMs ?? this.#config.pollTimeoutMs);
    return { handle, result: await this.#endPaymentStep(from, tracked.to, watched, handle) };
  }

  /** Wait for a payment left in flight, or one whose earlier wait timed out, to finish. */
  async awaitPayment(outcome: PaymentOutcome, options: { timeoutMs?: number } = {}): Promise<PaymentOutcome> {
    const target =
      outcome.paymentHash === null ? undefined : { hash: outcome.paymentHash, to: outcome.to, asset: "CKB" as const };
    const { result } = await this.#awaitTracked(outcome.from, target, options.timeoutMs);
    return this.#outcome(outcome.from, outcome.to, result);
  }

  async newInvoice(request: InvoiceRequest): Promise<CreatedInvoice> {
    const asset = request.asset ?? "CKB";
    const { to, amount, expiresInSec, finalExpiryDeltaSec, paymentHash } = request;
    const hold = request.hold === true || paymentHash !== undefined;
    const step = this.#store.beginStep("new_invoice", { to, amount, asset, hold });
    try {
      const preimage = paymentHash === undefined ? `0x${randomBytes(32).toString("hex")}` : null;
      const params: Record<string, unknown> = {
        amount: toHex(toBaseUnits(amount, asset)),
        currency: "Fibd",
        description: `${this.#scenario.name}:${to}`,
      };
      if (hold) {
        // A hold invoice is created from the hash alone: FNN must not know the preimage yet.
        params.payment_hash = paymentHash ?? ccc.hashCkb(preimage!);
        params.hash_algorithm = "ckb_hash";
      } else {
        params.payment_preimage = preimage;
      }
      if (expiresInSec !== undefined) params.expiry = `0x${expiresInSec.toString(16)}`;
      if (finalExpiryDeltaSec !== undefined) params.final_expiry_delta = toHex(BigInt(finalExpiryDeltaSec) * 1000n);
      if (asset === UDT_ASSET) params.udt_type_script = this.#udtScript(to);

      const res = (await this.#client.rawCall(to, "new_invoice", [{ ...params, ...request.params }])) as {
        invoice_address: string;
        invoice: { data: { payment_hash: string } };
      };
      const invoice: CreatedInvoice = {
        node: to,
        address: res.invoice_address,
        paymentHash: res.invoice.data.payment_hash,
        amount,
        asset,
        hold,
        preimage,
      };
      this.#lastInvoice.set(to, invoice);
      step.end(res);
      return invoice;
    } catch (error) {
      step.end({ error: messageOf(error) });
      throw error;
    }
  }

  async #invoiceAction(
    action: "settle_invoice" | "cancel_invoice",
    node: string,
    invoice: CreatedInvoice | undefined,
    call: (invoice: CreatedInvoice) => Promise<unknown>,
  ): Promise<{ handle: StepHandle; result: InvoiceActionResult }> {
    const handle = this.#store.beginStep(action, { node, payment_hash: invoice?.paymentHash ?? null });
    try {
      if (invoice === undefined) throw new Error(`${action}: "${node}" has created no invoice`);
      await call(invoice);
      handle.end({ ok: true }, await this.channelSnapshots());
      return { handle, result: { ok: true, error: null } };
    } catch (error) {
      const message = messageOf(error);
      handle.end({ error: message }, await this.channelSnapshots());
      return { handle, result: { ok: false, error: message } };
    }
  }

  #settle(node: string, invoice: CreatedInvoice | undefined, preimage?: string) {
    return this.#invoiceAction("settle_invoice", node, invoice, async (target) => {
      const secret = preimage ?? target.preimage;
      if (secret === null) throw new Error("settle_invoice: this invoice's preimage is not known to the lab");
      await this.#client.rawCall(node, "settle_invoice", [{ payment_hash: target.paymentHash, payment_preimage: secret }]);
    });
  }

  #cancel(node: string, invoice: CreatedInvoice | undefined) {
    return this.#invoiceAction("cancel_invoice", node, invoice, (target) =>
      this.#client.rawCall(node, "cancel_invoice", [{ payment_hash: target.paymentHash }]),
    );
  }

  /** A refused settle resolves with `{ ok: false, error }`, so a test can assert on the refusal. */
  async settleInvoice(invoice: CreatedInvoice, options: { preimage?: string } = {}): Promise<InvoiceActionResult> {
    return (await this.#settle(invoice.node, invoice, options.preimage)).result;
  }

  async cancelInvoice(invoice: CreatedInvoice): Promise<InvoiceActionResult> {
    return (await this.#cancel(invoice.node, invoice)).result;
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
    const container = this.#container(node);
    await killNode(container);
    this.#offline.add(node);
    step.end({ container });
  }

  async startNode(node: string): Promise<void> {
    const step = this.#store.beginStep("start_node", { node });
    const container = this.#container(node);
    const endpoint = await startNode(container, this.#config);
    if (endpoint !== null) {
      this.#client.setEndpoint(node, endpoint);
      this.#store.setNodeEndpoint(node, endpoint);
    }
    this.#offline.delete(node);
    await this.#waitForReconnect(node);
    step.end({ container, ready: true, endpoint });
  }

  /** A restarted node redials its peers by itself; a payment sent before that would fail for a
   *  reason no test intended. Soft, so a peer that is also down does not fail the restart. */
  async #waitForReconnect(node: string): Promise<void> {
    const peers = this.#neighbours(node).filter((peer) => !this.#offline.has(peer));
    const deadline = Date.now() + this.#config.pollTimeoutMs;
    while (Date.now() < deadline) {
      const states = await Promise.all(peers.map((peer) => this.#isConnected(node, peer).catch(() => false)));
      if (states.every(Boolean)) return;
      // FNN redials on a backoff of up to a minute, which made a restart take anywhere from 5 to 66 s.
      const missing = peers.filter((_, i) => !states[i]);
      await Promise.all(
        missing.map((peer) =>
          this.#client.rawCall(node, "connect_peer", [{ address: this.#node(peer).address }]).catch(() => null),
        ),
      );
      await sleep(this.#config.pollIntervalMs);
    }
  }

  /** Freeze a node with `docker pause`: it keeps its connections and answers nothing, the state
   *  that leaves an ordinary payment genuinely undecided. */
  async pauseNode(node: string): Promise<void> {
    const step = this.#store.beginStep("pause_node", { node });
    const container = this.#container(node);
    await pauseNode(container);
    this.#offline.add(node);
    step.end({ container });
  }

  async resumeNode(node: string): Promise<void> {
    const step = this.#store.beginStep("resume_node", { node });
    const container = this.#container(node);
    await resumeNode(container);
    this.#offline.delete(node);
    step.end({ container });
  }

  async disconnectPeer(from: string, to: string): Promise<void> {
    const step = this.#store.beginStep("disconnect_peer", { from, to });
    try {
      await this.#client.rawCall(from, "disconnect_peer", [{ pubkey: this.#node(to).pubkey }]);
      await this.#poll(async () => ((await this.#isConnected(from, to)) ? null : true), `${from} to drop ${to}`);
      step.end({ connected: false });
    } catch (error) {
      step.end({ error: messageOf(error) });
      throw error;
    }
  }

  async connectPeer(from: string, to: string): Promise<void> {
    const step = this.#store.beginStep("connect_peer", { from, to });
    try {
      await this.#client.rawCall(from, "connect_peer", [{ address: this.#node(to).address }]);
      await this.#poll(async () => ((await this.#isConnected(from, to)) ? true : null), `${from} to connect to ${to}`);
      step.end({ connected: true });
    } catch (error) {
      step.end({ error: messageOf(error) });
      throw error;
    }
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
      statuses[node] = invoice === undefined ? null : await this.invoiceStatus(node, invoice.paymentHash).catch(() => null);
    }
    return statuses;
  }

  async #peerStates(expect: StepExpectation): Promise<Record<string, boolean | null>> {
    const states: Record<string, boolean | null> = {};
    for (const { node, peer } of expect.peers ?? []) {
      states[`${node}->${peer}`] = this.#offline.has(node) ? null : await this.#isConnected(node, peer).catch(() => null);
    }
    return states;
  }

  /** Evaluate the state part of an expectation, polling until it holds or the timeout runs out:
   *  balances settle a moment after a payment reports Success (BR-POL-003). A check that depends
   *  on the chain has to keep the chain moving while it waits (BR-CHN-001). */
  async checkState(expect: StepExpectation, before: StatePoint | null = null): Promise<CheckResult[]> {
    const needsBlocks =
      expect.onchain !== undefined || (expect.channels ?? []).some((c) => c.state === "Closed" || c.state === "ShuttingDown");
    const deadline = Date.now() + this.#config.pollTimeoutMs;
    while (true) {
      const now = await this.#statePoint(expect);
      const results = [
        ...evaluateBalances(expect.balances ?? [], now.channels, before?.channels ?? null),
        ...evaluateChannels(expect.channels ?? [], now.channels),
        ...evaluateInvoices(expect.invoices ?? [], await this.#invoiceStatuses(expect)),
        ...evaluateOnchain(expect.onchain ?? [], now.onchain, before?.onchain ?? null),
        ...evaluatePeers(expect.peers ?? [], await this.#peerStates(expect)),
      ];
      if (results.every((r) => r.match) || Date.now() > deadline) return results;
      if (needsBlocks) await this.#chain.mine(1);
      await sleep(this.#config.pollIntervalMs);
    }
  }

  async #perform(step: SeedStep): Promise<{ handle?: StepHandle; result: StepResult }> {
    const timeoutMs = step.timeoutSec === undefined ? undefined : step.timeoutSec * 1000;
    switch (step.action) {
      case "send_payment": {
        const request: PaymentRequest = {
          from: step.from!,
          to: step.to!,
          amount: step.amount!,
          asset: step.asset,
          waitFor: step.waitFor,
          timeoutMs,
        };
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
      case "await_payment":
        return this.#awaitTracked(step.from!, this.#lastPayment.get(step.from!), timeoutMs);
      case "new_invoice":
        await this.newInvoice({
          to: step.to!,
          amount: step.amount!,
          asset: step.asset,
          expiresInSec: step.expiresInSec,
          hold: step.hold,
          finalExpiryDeltaSec: step.finalExpiryDeltaSec,
        });
        return { result: null };
      case "settle_invoice": {
        const { handle, result } = await this.#settle(
          step.node!,
          this.#lastInvoice.get(step.node!),
          step.wrongPreimage ? WRONG_PREIMAGE : undefined,
        );
        return { handle, result: result.error === null ? {} : { error: result.error } };
      }
      case "cancel_invoice": {
        const { handle, result } = await this.#cancel(step.node!, this.#lastInvoice.get(step.node!));
        return { handle, result: result.error === null ? {} : { error: result.error } };
      }
      case "close_channel": {
        const { handle, result } = await this.#close({ from: step.from!, to: step.to!, force: step.force });
        return { handle, result: result.error === null ? {} : { error: result.error } };
      }
      case "disconnect_peer":
        await this.disconnectPeer(step.from!, step.to!);
        return { result: null };
      case "connect_peer":
        await this.connectPeer(step.from!, step.to!);
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
      case "pause_node":
        await this.pauseNode(step.node!);
        return { result: null };
      case "resume_node":
        await this.resumeNode(step.node!);
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

  #paymentAsset(step: SeedStep): Asset {
    return step.asset ?? (step.from === undefined ? undefined : this.#lastPayment.get(step.from)?.asset) ?? "CKB";
  }

  /** Run one seed step and record what its expectations found on the step itself. */
  async runStep(step: SeedStep, options: { verify?: boolean } = {}): Promise<StepCheck[]> {
    const verify = options.verify ?? true;
    const expect = verify ? step.expect : undefined;
    const before = expect !== undefined && needsBeforeState(expect) ? await this.#statePoint(expect) : null;
    const { handle, result } = await this.#perform(step);
    if (!verify) return [];

    const refusal = result?.error === undefined ? null : String(result.error);
    const checks = [
      ...(expect !== undefined && PAYMENT_ACTIONS.includes(step.action)
        ? evaluatePayment(expect, result, this.#paymentAsset(step))
        : []),
      ...(REFUSABLE_ACTIONS.includes(step.action) ? evaluateRefusal(step.action, expect?.error, refusal) : []),
      ...(expect === undefined ? [] : await this.checkState(expect, before)),
    ];
    if (checks.length === 0) return [];
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
      if (step.action !== "assert") await this.runStep(step, { verify: false });
    }
  }
}
