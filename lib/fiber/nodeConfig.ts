import { randomBytes } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import { fnnNodeDir } from "../../topology/compose.template";
import type { GenesisFacts } from "../ckb/chain";
import {
  CKB_RPC_PORT,
  CKB_SERVICE,
  DEV_CHAIN_SPEC,
  DEV_FUNDED_KEYS,
  FNN_P2P_PORT,
  FNN_RPC_PORT,
  FNN_TX_TRACING_POLLING_MS,
  UDT_ASSET,
} from "../constants";
import type { Scenario } from "../scenario/schema";

export interface GeneratedNode {
  node: string;
  dir: string;
  ckbPrivKey: string;
}

export function nodeConfigYaml(node: string, genesis: GenesisFacts): string {
  const { simpleUdt } = genesis;
  return stringify({
    fiber: {
      listening_addr: `/ip4/0.0.0.0/tcp/${FNN_P2P_PORT}`,
      announced_node_name: node,
      // Announce a /dns4/<node> address (resolves via docker DNS on the network) so peers can connect.
      announce_listening_addr: true,
      announced_addrs: [`/dns4/${node}/tcp/${FNN_P2P_PORT}`],
      chain: DEV_CHAIN_SPEC,
      auto_announce_node: true,
      announce_private_addr: true,
    },
    rpc: {
      // The entrypoint overrides RPC_LISTENING_ADDR = <container-ip>:port (to bypass biscuit auth).
      listening_addr: `0.0.0.0:${FNN_RPC_PORT}`,
      enabled_modules: ["channel", "payment", "graph", "info", "invoice", "peer", "pubsub", "dev"],
    },
    ckb: {
      rpc_url: `http://${CKB_SERVICE}:${CKB_RPC_PORT}`,
      tx_tracing_polling_interval_ms: FNN_TX_TRACING_POLLING_MS,
      udt_whitelist: [
        {
          name: UDT_ASSET,
          script: { code_hash: simpleUdt.codeHash, hash_type: "data", args: "0x.*" },
          cell_deps: [
            {
              cell_dep: {
                out_point: { tx_hash: simpleUdt.txHash, index: `0x${simpleUdt.index.toString(16)}` },
                dep_type: "code",
              },
            },
          ],
          auto_accept_amount: 1,
        },
      ],
    },
    services: ["fiber", "rpc", "ckb"],
  });
}

export async function generateNodeConfigs(
  scenario: Scenario,
  runId: string,
  genesis: GenesisFacts,
): Promise<GeneratedNode[]> {
  const generated: GeneratedNode[] = [];

  for (const [i, node] of scenario.nodes.entries()) {
    const dir = fnnNodeDir(runId, node);
    await mkdir(join(dir, "fiber"), { recursive: true });
    await mkdir(join(dir, "ckb"), { recursive: true });

    await writeFile(join(dir, "fiber", "sk"), randomBytes(32));
    await chmod(join(dir, "fiber", "sk"), 0o600);

    const ckbPrivKey = DEV_FUNDED_KEYS[i]!;
    await writeFile(join(dir, "ckb", "key"), ckbPrivKey);

    await writeFile(join(dir, "config.yml"), nodeConfigYaml(node, genesis));

    generated.push({ node, dir, ckbPrivKey });
  }

  return generated;
}
