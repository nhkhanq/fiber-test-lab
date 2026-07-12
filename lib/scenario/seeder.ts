import { randomBytes } from "node:crypto";
import type { GlobalConfig } from "../config";
import type { FiberClient } from "../fiber/client";
import { DEV_FUNDED_KEYS, SHANNON_PER_CKB, UDT_ASSET } from "../constants";
import { killNode, startNode } from "../docker/orchestrator";
import { mintUdt, type UdtScript } from "../fiber/udt";
import type { RunLogStore } from "../runlog/store";
import { containerName } from "../../topology/compose.template";
import type { Asset, Scenario } from "./schema";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** CKB → shannon (BigInt, hợp NumLike của ccc). */
function ckbToShannon(ckb: number): bigint {
  return BigInt(ckb) * SHANNON_PER_CKB;
}

/** Số tiền hex theo asset: CKB → shannon (×1e8); UDT (RUSD) → đơn vị token thô. */
function amountHex(value: number, asset: Asset): string {
  const raw = asset === UDT_ASSET ? BigInt(value) : ckbToShannon(value);
  return `0x${raw.toString(16)}`;
}

/** Target còn kết nối với node gửi không (list_peers). Dùng để phân biệt peer_offline vs insufficient_outbound. */
async function isPeerConnected(client: FiberClient, node: string, peerPubkey: string): Promise<boolean> {
  const res = (await client.rawCall(node, "list_peers")) as { peers: { pubkey?: string }[] };
  const want = peerPubkey.toLowerCase();
  return res.peers.some((p) => p.pubkey?.toLowerCase() === want);
}

/** Poll list_peers(node) tới khi peer đã connected (Init xong) — trước khi open_channel. */
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
    if (Date.now() > deadline) throw new Error(`Timeout chờ peer ${peerPubkey.slice(0, 12)}…`);
    await sleep(config.pollIntervalMs);
  }
}

/**
 * open_channel (raw RPC, field `pubkey` cho FNN 0.8) + retry lỗi handshake transient
 * ("waiting for peer to send Init"). funding_amount hex theo asset; kênh UDT kèm funding_udt_type_script.
 */
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

/**
 * Chờ graph của node gửi biết 1 channel chạm tới target (gossip đã lan) trước khi send_payment —
 * tránh "PathFind error: no path found" khi route multi-hop chưa propagate (BR-DET-001). Best-effort:
 * hết timeout thì vẫn để send_payment chạy để lấy lỗi thật. Direct peer đã có sẵn trong graph → trả ngay.
 */
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

/** Poll get_payment tới khi Success/Failed (send_payment là async — status đầu là Created/Inflight). */
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
    if (Date.now() > deadline) throw new Error(`Timeout chờ payment ${paymentHash.slice(0, 12)}… (status ${p.status})`);
    await sleep(config.pollIntervalMs);
  }
}

/** Poll list_channels(node) tới khi channel với peer đạt ChannelReady (BR-POL-002). */
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
      throw new Error(`Timeout chờ ChannelReady ${node}→${peerPubkey.slice(0, 12)}… (state: ${ch?.state.state_name ?? "none"})`);
    }
    await sleep(config.pollIntervalMs);
  }
}

interface ResolvedNode {
  pubkey: string;
  address: string;
}

/** node_info cho mọi node → pubkey + address dial được (SDK canary lệch field FNN 0.8 nên dùng rawCall). */
async function resolveNodes(
  scenario: Scenario,
  client: FiberClient,
): Promise<Record<string, ResolvedNode>> {
  const resolved: Record<string, ResolvedNode> = {};
  for (const node of scenario.nodes) {
    const info = (await client.rawCall(node, "node_info")) as { pubkey: string; addresses: string[] };
    // /dns4/<node>/... resolve qua docker DNS — addresses[0] thường là 0.0.0.0 không dial được.
    const address = info.addresses.find((a) => a.startsWith("/dns4/")) ?? info.addresses[0] ?? "";
    resolved[node] = { pubkey: info.pubkey, address };
  }
  return resolved;
}

/**
 * Thực thi phần `channels` + `seed` của scenario qua FiberClient (mọi RPC đã log vào run-log).
 * Node đã READY (orchestrator chờ trước). runId cần để derive tên container cho kill_node/start_node.
 */
export async function runSeed(
  scenario: Scenario,
  client: FiberClient,
  store: RunLogStore,
  config: GlobalConfig,
  runId: string,
  ckbEndpoint: string | null,
): Promise<void> {
  const nodes = await resolveNodes(scenario, client);
  const udtByNode: Record<string, UdtScript> = {}; // script sUDT mà node đó nắm giữ (đã mint) — E8-4

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
    store.recordStep("open_channel", { from: ch.from, to: ch.to, capacity: ch.capacity, asset: ch.asset }, { ready: true });
  }

  await runSeedSteps(scenario, client, store, config, runId, nodes, udtByNode);
}

/** Mint sUDT cho `node` (owner = key CKB genesis của node) — funding kênh UDT cần dư token. */
async function mintForNode(
  scenario: Scenario,
  node: string,
  capacity: number,
  ckbEndpoint: string | null,
  store: RunLogStore,
): Promise<UdtScript> {
  if (!ckbEndpoint) throw new Error("Scenario dùng UDT nhưng thiếu ckbEndpoint (CKB chưa map port).");
  const key = DEV_FUNDED_KEYS[scenario.nodes.indexOf(node)]!;
  const udt = await mintUdt(ckbEndpoint, key, BigInt(capacity) * 100n); // mint dư (×100) so với funding
  store.recordStep("mint_udt", { node, amount: capacity * 100, asset: UDT_ASSET }, udt);
  return udt;
}

/**
 * Chỉ chạy các `seed` step (không mở channel) — dùng cho lệnh `fiber-lab seed` chạy lại trên run đang chạy.
 * Tự resolve node_info nếu chưa có (VD gọi độc lập, không đi qua `runSeed`).
 */
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
  const invoices: Record<string, string> = {}; // invoice_address theo node nhận (new_invoice → send_payment useInvoice)

  for (const step of scenario.seed) {
    switch (step.action) {
      case "send_payment": {
        const asset: Asset = step.asset ?? "CKB";
        const input = { from: step.from, to: step.to, amount: step.amount, asset };
        try {
          let paymentParams: Record<string, unknown>;
          if (step.useInvoice) {
            const invoice = invoices[step.to!];
            if (!invoice) throw new Error(`send_payment useInvoice: chưa có invoice cho "${step.to}"`);
            paymentParams = { invoice };
          } else {
            await waitForRoute(client, step.from!, pubkey[step.to!]!, config);
            paymentParams = { target_pubkey: pubkey[step.to!]!, amount: amountHex(step.amount!, asset), keysend: true };
            if (asset === UDT_ASSET) paymentParams.udt_type_script = udtByNode[step.from!];
          }
          // send_payment có thể lỗi đồng bộ (insufficient outbound / invoice expired) — record, KHÔNG throw.
          const res = (await client.rawCall(step.from!, "send_payment", [paymentParams])) as { payment_hash: string };
          const final = await waitPayment(client, step.from!, res.payment_hash, config);
          store.recordStep("send_payment", input, final);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          // Lỗi "max outbound liquidity 0" khi peer offline TRÙNG với insufficient_outbound → ghi kèm
          // trạng thái kết nối để phân loại đúng (E8-2). Kiểm HOP ĐẦU (peer của kênh sender cấp vốn),
          // KHÔNG phải target cuối — multi-hop thì target không phải peer trực tiếp. Lỗi truy vấn → coi như còn kết nối.
          const firstHop = scenario.channels.find((c) => c.from === step.from)?.to ?? step.to!;
          const peerConnected = await isPeerConnected(client, step.from!, pubkey[firstHop]!).catch(() => true);
          store.recordStep("send_payment", input, { error: message, peerConnected });
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
