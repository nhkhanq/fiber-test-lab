import { randomBytes } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import { fnnNodeDir } from "../../topology/compose.template";
import {
  CKB_RPC_PORT,
  CKB_SERVICE,
  DEV_CHAIN_SPEC,
  DEV_FUNDED_KEYS,
  FNN_P2P_PORT,
  FNN_RPC_PORT,
} from "../constants";
import type { Scenario } from "../scenario/schema";

export interface GeneratedNode {
  node: string;
  dir: string;
  ckbPrivKey: string;
}

function nodeConfigYaml(node: string): string {
  return stringify({
    fiber: {
      listening_addr: `/ip4/0.0.0.0/tcp/${FNN_P2P_PORT}`,
      announced_node_name: node,
      // announce địa chỉ dns4 theo tên node (resolve qua docker DNS trong network) → peer connect được.
      announce_listening_addr: true,
      announced_addrs: [`/dns4/${node}/tcp/${FNN_P2P_PORT}`],
      chain: DEV_CHAIN_SPEC,
      auto_announce_node: true,
      announce_private_addr: true,
    },
    rpc: {
      // entrypoint override RPC_LISTENING_ADDR = <container-ip>:port (tránh biscuit).
      listening_addr: `0.0.0.0:${FNN_RPC_PORT}`,
      enabled_modules: ["channel", "payment", "graph", "info", "invoice", "peer", "pubsub", "dev"],
    },
    ckb: { rpc_url: `http://${CKB_SERVICE}:${CKB_RPC_PORT}` },
    services: ["fiber", "rpc", "ckb"],
  });
}

/**
 * Sinh base dir per-node (config.yml + fiber/sk + ckb/key) trước khi `up`.
 * Key ngẫu nhiên theo run (lưu lại để faucet cấp tiền + test-kit dùng).
 */
export async function generateNodeConfigs(
  scenario: Scenario,
  runId: string,
): Promise<GeneratedNode[]> {
  if (scenario.nodes.length > DEV_FUNDED_KEYS.length) {
    throw new Error(
      `Scenario "${scenario.name}" có ${scenario.nodes.length} node, chỉ có ${DEV_FUNDED_KEYS.length} account pre-fund trong genesis.`,
    );
  }

  const generated: GeneratedNode[] = [];

  for (const [i, node] of scenario.nodes.entries()) {
    const dir = fnnNodeDir(runId, node);
    await mkdir(join(dir, "fiber"), { recursive: true });
    await mkdir(join(dir, "ckb"), { recursive: true });

    await writeFile(join(dir, "fiber", "sk"), randomBytes(32));
    await chmod(join(dir, "fiber", "sk"), 0o600);

    // Key pre-fund theo index (10 tỷ CKB từ genesis) — mở channel không cần faucet.
    const ckbPrivKey = DEV_FUNDED_KEYS[i]!;
    await writeFile(join(dir, "ckb", "key"), ckbPrivKey);

    await writeFile(join(dir, "config.yml"), nodeConfigYaml(node));

    generated.push({ node, dir, ckbPrivKey });
  }

  return generated;
}
