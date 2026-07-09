import { randomBytes } from "node:crypto";
import type { GlobalConfig } from "../config";
import type { FiberClient } from "../fiber/client";
import { SHANNON_PER_CKB } from "../constants";
import { killNode, startNode } from "../docker/orchestrator";
import type { RunLogStore } from "../runlog/store";
import { containerName } from "../../topology/compose.template";
import type { Scenario } from "./schema";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** CKB → shannon (BigInt, hợp NumLike của ccc). */
function ckbToShannon(ckb: number): bigint {
  return BigInt(ckb) * SHANNON_PER_CKB;
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
 * ("waiting for peer to send Init"). funding_amount = hex shannon.
 */
async function openChannel(
  client: FiberClient,
  from: string,
  peerPubkey: string,
  capacityCkb: number,
  config: GlobalConfig,
): Promise<void> {
  const fundingAmount = `0x${ckbToShannon(capacityCkb).toString(16)}`;
  const deadline = Date.now() + config.pollTimeoutMs;
  while (true) {
    try {
      await client.rawCall(from, "open_channel", [{ pubkey: peerPubkey, funding_amount: fundingAmount }]);
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
): Promise<void> {
  const nodes = await resolveNodes(scenario, client);

  for (const ch of scenario.channels) {
    await client.connectPeer(ch.from, { address: nodes[ch.to]!.address });
    await waitForPeer(client, ch.from, nodes[ch.to]!.pubkey, config);
    await openChannel(client, ch.from, nodes[ch.to]!.pubkey, ch.capacity, config);
    await waitChannelReady(client, ch.from, nodes[ch.to]!.pubkey, config);
    store.recordStep("open_channel", { from: ch.from, to: ch.to, capacity: ch.capacity }, { ready: true });
  }

  await runSeedSteps(scenario, client, store, config, runId, nodes);
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
): Promise<void> {
  const nodes = resolved ?? (await resolveNodes(scenario, client));
  const pubkey = Object.fromEntries(Object.entries(nodes).map(([n, r]) => [n, r.pubkey]));

  for (const step of scenario.seed) {
    switch (step.action) {
      case "send_payment": {
        const amount = `0x${ckbToShannon(step.amount!).toString(16)}`;
        const input = { from: step.from, to: step.to, amount: step.amount };
        try {
          await waitForRoute(client, step.from!, pubkey[step.to!]!, config);
          // send_payment có thể lỗi đồng bộ (vd insufficient outbound) — record, KHÔNG throw.
          const res = (await client.rawCall(step.from!, "send_payment", [
            { target_pubkey: pubkey[step.to!]!, amount, keysend: true },
          ])) as { payment_hash: string };
          const final = await waitPayment(client, step.from!, res.payment_hash, config);
          store.recordStep("send_payment", input, final);
        } catch (e) {
          store.recordStep("send_payment", input, { error: e instanceof Error ? e.message : String(e) });
        }
        break;
      }
      case "new_invoice": {
        const res = await client.newInvoice(step.to!, {
          amount: ckbToShannon(step.amount!),
          currency: "Fibd",
          paymentPreimage: `0x${randomBytes(32).toString("hex")}`,
          expiry: step.expiresInSec,
        });
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
