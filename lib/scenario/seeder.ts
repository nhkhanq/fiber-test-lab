import { randomBytes } from "node:crypto";
import type { GlobalConfig } from "../config";
import type { FiberClient } from "../fiber/client";
import { DEV_FUNDED_KEYS, SHANNON_PER_CKB, UDT_ASSET } from "../constants";
import { killNode, startNode } from "../docker/orchestrator";
import { mintUdt, type UdtScript } from "../fiber/udt";
import type { ChannelSnapshot, RunLogStore } from "../runlog/store";
import { containerName } from "../../topology/compose.template";
import type { Asset, Scenario } from "./schema";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ckbToShannon(ckb: number): bigint {
  return BigInt(ckb) * SHANNON_PER_CKB;
}

function amountHex(value: number, asset: Asset): string {
  const raw = asset === UDT_ASSET ? BigInt(value) : ckbToShannon(value);
  return `0x${raw.toString(16)}`;
}

async function isPeerConnected(client: FiberClient, node: string, peerPubkey: string): Promise<boolean> {
  const res = (await client.rawCall(node, "list_peers")) as { peers: { pubkey?: string }[] };
  const want = peerPubkey.toLowerCase();
  return res.peers.some((p) => p.pubkey?.toLowerCase() === want);
}

async function waitForPeer(
  client: FiberClient,
  node: string,
  peerPubkey: string,
  config: GlobalConfig,
): Promise<void> {
  const deadline = Date.now() + config.pollTimeoutMs;
  const want = peerPubkey.toLowerCase();
  while (true) {
    const res = (await client.rawCall(node, "list_peers")) as { peers: { pubkey?: string }[] };
    if (res.peers.some((p) => p.pubkey?.toLowerCase() === want)) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for peer ${peerPubkey.slice(0, 12)}…`);
    await sleep(config.pollIntervalMs);
  }
}

async function openChannel(
  client: FiberClient,
  from: string,
  peerPubkey: string,
  capacity: number,
  asset: Asset,
  udt: UdtScript | undefined,
  config: GlobalConfig,
): Promise<void> {
  const params: Record<string, unknown> = { pubkey: peerPubkey, funding_amount: amountHex(capacity, asset) };
  if (udt) params.funding_udt_type_script = udt;
  const deadline = Date.now() + config.pollTimeoutMs;
  while (true) {
    try {
      await client.rawCall(from, "open_channel", [params]);
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (Date.now() < deadline && /waiting for peer|Init|feature not found/i.test(msg)) {
        await sleep(config.pollIntervalMs);
        continue;
      }
      throw e;
    }
  }
}

async function waitForRoute(
  client: FiberClient,
  from: string,
  targetPubkey: string,
  config: GlobalConfig,
): Promise<void> {
  const deadline = Date.now() + config.pollTimeoutMs;
  const want = targetPubkey.toLowerCase();
  while (Date.now() < deadline) {
    const res = (await client.rawCall(from, "graph_channels", [{}])) as {
      channels: { node1?: string; node2?: string }[];
    };
    if (res.channels.some((c) => c.node1?.toLowerCase() === want || c.node2?.toLowerCase() === want)) return;
    await sleep(config.pollIntervalMs);
  }
}

async function waitPayment(
  client: FiberClient,
  node: string,
  paymentHash: string,
  config: GlobalConfig,
): Promise<{ status: string }> {
  const deadline = Date.now() + config.pollTimeoutMs;
  while (true) {
    const p = (await client.rawCall(node, "get_payment", [{ payment_hash: paymentHash }])) as {
      status: string;
    };
    if (p.status === "Success" || p.status === "Failed") return p;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for payment ${paymentHash.slice(0, 12)}… (status ${p.status})`);
    await sleep(config.pollIntervalMs);
  }
}

async function waitChannelReady(
  client: FiberClient,
  node: string,
  peerPubkey: string,
  config: GlobalConfig,
): Promise<void> {
  const deadline = Date.now() + config.pollTimeoutMs;
  const want = peerPubkey.toLowerCase();
  while (true) {
    const res = (await client.rawCall(node, "list_channels", [{}])) as {
      channels: { pubkey?: string; peer_id?: string; state: { state_name: string } }[];
    };
    const ch = res.channels.find((c) => (c.pubkey ?? c.peer_id)?.toLowerCase() === want);
    if (ch && ch.state.state_name === "ChannelReady") return;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ChannelReady ${node}->${peerPubkey.slice(0, 12)}… (state: ${ch?.state.state_name ?? "none"})`);
    }
    await sleep(config.pollIntervalMs);
  }
}

interface ResolvedNode {
  pubkey: string;
  address: string;
}

async function resolveNodes(
  scenario: Scenario,
  client: FiberClient,
): Promise<Record<string, ResolvedNode>> {
  const resolved: Record<string, ResolvedNode> = {};
  for (const node of scenario.nodes) {
    const info = (await client.rawCall(node, "node_info")) as { pubkey: string; addresses: string[] };
    // Prefer /dns4/<node>/... (resolves via docker DNS) — addresses[0] is often 0.0.0.0, which isn't dial-able.
    const address = info.addresses.find((a) => a.startsWith("/dns4/")) ?? info.addresses[0] ?? "";
    resolved[node] = { pubkey: info.pubkey, address };
  }
  return resolved;
}

function hexToDecimal(value: string | undefined): string | null {
  if (value === undefined || value === null) return null;
  try {
    return BigInt(value).toString();
  } catch {
    return null;
  }
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

/** Every node's view of its channels, stored on the step that changed them so the run viewer can
 *  draw the topology without reverse-engineering it out of scattered list_channels responses.
 *  Never throws: a snapshot is a debugging aid, not part of the scenario's outcome. */
async function captureChannels(
  client: FiberClient,
  nodes: Record<string, ResolvedNode>,
): Promise<ChannelSnapshot[]> {
  const nameByPubkey = new Map(
    Object.entries(nodes).map(([name, r]) => [r.pubkey.toLowerCase(), name]),
  );
  const snapshots: ChannelSnapshot[] = [];
  for (const node of Object.keys(nodes)) {
    const res = (await client
      .rawCall(node, "list_channels", [{}])
      .catch(() => null)) as { channels?: RawChannel[] } | null;
    for (const ch of res?.channels ?? []) {
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

export async function runSeed(
  scenario: Scenario,
  client: FiberClient,
  store: RunLogStore,
  config: GlobalConfig,
  runId: string,
  ckbEndpoint: string | null,
): Promise<void> {
  const nodes = await resolveNodes(scenario, client);
  const udtByNode: Record<string, UdtScript> = {}; // the sUDT script each node holds (minted) — E8-4

  for (const ch of scenario.channels) {
    let udt: UdtScript | undefined;
    if (ch.asset === UDT_ASSET) {
      udt = udtByNode[ch.from] ?? (await mintForNode(scenario, ch.from, ch.capacity, ckbEndpoint, store));
      udtByNode[ch.from] = udt;
    }
    await client.connectPeer(ch.from, { address: nodes[ch.to]!.address });
    await waitForPeer(client, ch.from, nodes[ch.to]!.pubkey, config);
    await openChannel(client, ch.from, nodes[ch.to]!.pubkey, ch.capacity, ch.asset, udt, config);
    await waitChannelReady(client, ch.from, nodes[ch.to]!.pubkey, config);
    store.recordStep(
      "open_channel",
      { from: ch.from, to: ch.to, capacity: ch.capacity, asset: ch.asset },
      { ready: true },
      await captureChannels(client, nodes),
    );
  }

  await runSeedSteps(scenario, client, store, config, runId, nodes, udtByNode);
}

async function mintForNode(
  scenario: Scenario,
  node: string,
  capacity: number,
  ckbEndpoint: string | null,
  store: RunLogStore,
): Promise<UdtScript> {
  if (!ckbEndpoint) throw new Error("Scenario uses UDT but ckbEndpoint is missing (CKB port not mapped).");
  const key = DEV_FUNDED_KEYS[scenario.nodes.indexOf(node)]!;
  const udt = await mintUdt(ckbEndpoint, key, BigInt(capacity) * 100n); // mint 100x the funding amount as headroom
  store.recordStep("mint_udt", { node, amount: capacity * 100, asset: UDT_ASSET }, udt);
  return udt;
}


export async function runSeedSteps(
  scenario: Scenario,
  client: FiberClient,
  store: RunLogStore,
  config: GlobalConfig,
  runId: string,
  resolved?: Record<string, ResolvedNode>,
  udtByNode: Record<string, UdtScript> = {},
): Promise<void> {
  const nodes = resolved ?? (await resolveNodes(scenario, client));
  const pubkey = Object.fromEntries(Object.entries(nodes).map(([n, r]) => [n, r.pubkey]));
  const invoices: Record<string, string> = {}; // invoice_address per recipient node (new_invoice -> send_payment useInvoice)

  for (const step of scenario.seed) {
    switch (step.action) {
      case "send_payment": {
        const asset: Asset = step.asset ?? "CKB";
        const input = { from: step.from, to: step.to, amount: step.amount, asset };
        try {
          let paymentParams: Record<string, unknown>;
          if (step.useInvoice) {
            const invoice = invoices[step.to!];
            if (!invoice) throw new Error(`send_payment useInvoice: no invoice for "${step.to}"`);
            paymentParams = { invoice };
          } else {
            await waitForRoute(client, step.from!, pubkey[step.to!]!, config);
            paymentParams = { target_pubkey: pubkey[step.to!]!, amount: amountHex(step.amount!, asset), keysend: true };
            if (asset === UDT_ASSET) paymentParams.udt_type_script = udtByNode[step.from!];
          }
          // send_payment can fail synchronously (insufficient outbound / expired invoice) — record it, don't throw.
          const res = (await client.rawCall(step.from!, "send_payment", [paymentParams])) as { payment_hash: string };
          const final = await waitPayment(client, step.from!, res.payment_hash, config);
          store.recordStep("send_payment", input, final, await captureChannels(client, nodes));
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          const firstHop = scenario.channels.find((c) => c.from === step.from)?.to ?? step.to!;
          const peerConnected = await isPeerConnected(client, step.from!, pubkey[firstHop]!).catch(() => true);
          store.recordStep(
            "send_payment",
            input,
            { error: message, peerConnected },
            await captureChannels(client, nodes),
          );
        }
        break;
      }
      case "new_invoice": {
        const params: Record<string, unknown> = {
          amount: `0x${ckbToShannon(step.amount!).toString(16)}`,
          currency: "Fibd",
          payment_preimage: `0x${randomBytes(32).toString("hex")}`,
          description: `${scenario.name}:${step.to}`,
        };
        if (step.expiresInSec !== undefined) params.expiry = `0x${step.expiresInSec.toString(16)}`;
        const res = (await client.rawCall(step.to!, "new_invoice", [params])) as { invoice_address: string };
        invoices[step.to!] = res.invoice_address;
        store.recordStep("new_invoice", { to: step.to, amount: step.amount }, res);
        break;
      }
      case "wait": {
        await sleep(step.durationSec! * 1000);
        store.recordStep("wait", { durationSec: step.durationSec });
        break;
      }
      case "kill_node": {
        const container = containerName(config, runId, step.node!);
        await killNode(container);
        store.recordStep("kill_node", { node: step.node }, { container });
        break;
      }
      case "start_node": {
        const container = containerName(config, runId, step.node!);
        await startNode(container, config);
        store.recordStep("start_node", { node: step.node }, { container, ready: true });
        break;
      }
    }
  }
}
