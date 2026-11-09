import type { GenesisFacts, LockScript } from "../ckb/chain";
import { CKB_SERVICE, DEV_FUNDED_KEYS } from "../constants";
import type { RunLog } from "../runlog/store";

export interface EnvironmentNode {
  name: string;
  rpc: string | null;
  pubkey: string | null;
  address: string | null;
  lock: LockScript | null;
  /** The node's funded devnet key: public knowledge, and worthless anywhere but this devnet. */
  privateKey: string | null;
}

/** Everything a client in any language needs to use a run, read from its run-log alone. */
export interface Environment {
  runId: string;
  scenario: string;
  network: string;
  status: RunLog["status"];
  versions: { fnn: string; ckb: string } | null;
  ckb: { rpc: string | null; genesis: GenesisFacts | null };
  nodes: Record<string, EnvironmentNode>;
}

interface NodeInfoResponse {
  pubkey?: string;
  addresses?: string[];
  default_funding_lock_script?: LockScript;
}

export function describeEnvironment(log: RunLog): Environment {
  const chainReady = log.steps.find((s) => s.action === "chain_ready")?.result as { facts?: GenesisFacts } | null | undefined;
  const fnnNodes = log.nodes.filter((n) => n.name !== CKB_SERVICE);

  const nodes: Record<string, EnvironmentNode> = {};
  fnnNodes.forEach((node, index) => {
    const info = log.rpcCalls.find((r) => r.node === node.name && r.method === "node_info" && r.response !== null)
      ?.response as NodeInfoResponse | undefined;
    nodes[node.name] = {
      name: node.name,
      rpc: node.endpoint,
      pubkey: info?.pubkey ?? null,
      address: info?.addresses?.find((a) => a.startsWith("/dns4/")) ?? null,
      lock: info?.default_funding_lock_script ?? null,
      privateKey: DEV_FUNDED_KEYS[index] === undefined ? null : `0x${DEV_FUNDED_KEYS[index]}`,
    };
  });

  return {
    runId: log.runId,
    scenario: log.scenario,
    network: log.network,
    status: log.status,
    versions: log.versions ?? null,
    ckb: { rpc: log.nodes.find((n) => n.name === CKB_SERVICE)?.endpoint ?? null, genesis: chainReady?.facts ?? null },
    nodes,
  };
}

const envName = (node: string) => node.toUpperCase().replace(/[^A-Z0-9]/g, "_");

/** The same facts as `KEY=value` lines, for a shell, a dotenv loader or a Makefile. */
export function renderDotenv(env: Environment): string {
  const lines = [`FIBER_LAB_RUN_ID=${env.runId}`, `FIBER_LAB_CKB_RPC=${env.ckb.rpc ?? ""}`];
  for (const node of Object.values(env.nodes)) {
    const prefix = `FIBER_LAB_NODE_${envName(node.name)}`;
    lines.push(`${prefix}_RPC=${node.rpc ?? ""}`, `${prefix}_PUBKEY=${node.pubkey ?? ""}`, `${prefix}_PRIVATE_KEY=${node.privateKey ?? ""}`);
  }
  return `${lines.join("\n")}\n`;
}
