import { randomBytes } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import { fnnNodeDir } from "../../topology/compose.template";
import {
  CKB_RPC_PORT,
  CKB_SERVICE,
  DEV_CHAIN_SPEC,
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
  const generated: GeneratedNode[] = [];

  for (const node of scenario.nodes) {
    const dir = fnnNodeDir(runId, node);
    await mkdir(join(dir, "fiber"), { recursive: true });
    await mkdir(join(dir, "ckb"), { recursive: true });

    await writeFile(join(dir, "fiber", "sk"), randomBytes(32));
    await chmod(join(dir, "fiber", "sk"), 0o600);

    const ckbPrivKey = randomBytes(32).toString("hex");
    await writeFile(join(dir, "ckb", "key"), ckbPrivKey);

    await writeFile(join(dir, "config.yml"), nodeConfigYaml(node));

    generated.push({ node, dir, ckbPrivKey });
  }

  return generated;
}
