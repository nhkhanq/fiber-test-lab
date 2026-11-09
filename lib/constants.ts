import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export const EXIT_CODES = {
  ok: 0,
  validation: 1, // config / schema error
  runtime: 2, // docker / RPC error
  expectation: 3, // expectation mismatch
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export const SHANNON_PER_CKB = 100_000_000n;

export const MIN_CHANNEL_CAPACITY_CKB = 100;
export const MIN_CHANNEL_RESERVE_CKB = 99;

export const RUNS_DIR = ".fiber-lab/runs";
export const WORK_DIR = ".fiber-lab/work"; // compose files are materialized per run-id
export const SCENARIOS_DIR = join(PACKAGE_ROOT, "topology/scenarios");

export const CKB_VERSION = "0.207.0"; // nervos/ckb devnet, aligned with offckb 0.4.7 genesis

export const CKB_RPC_PORT = 8114;
export const FNN_RPC_PORT = 8227; // FNN JSON-RPC (node_info/open_channel/...)
export const FNN_P2P_PORT = 8228; // FNN gossip/p2p

export const CKB_SERVICE = "ckb";

export const DOCKER_BUILD_CONTEXT = join(PACKAGE_ROOT, "topology/docker");
export const FNN_DOCKERFILE = "fnn.Dockerfile";
export const CKB_DOCKERFILE = "ckb.Dockerfile";
export const FNN_IMAGE_NAME = "flab-fnn";
export const CKB_IMAGE_NAME = "flab-ckb";

export const FNN_BASE_DIR = "/fiber-node";
export const DEV_CHAIN_SPEC = "/flab/dev.toml";
export const FNN_SECRET_KEY_PASSWORD = "flab-dev";

export const FNN_GOSSIP_NETWORK_INTERVAL_MS = 2000;
export const FNN_GOSSIP_STORE_INTERVAL_MS = 2000;
export const FNN_TX_TRACING_POLLING_MS = 500;
export const FNN_WATCHTOWER_CHECK_INTERVAL_SECONDS = 2;

export const RECOMMENDED_MAX_NODES = 3;

export const GENESIS_SIMPLE_UDT_INDEX = 8;

export const UDT_ASSET = "RUSD" as const; // scenario asset name mapped to simple_udt

export const DEV_FUNDED_KEYS = [
  "1111111111111111111111111111111111111111111111111111111111111111",
  "2222222222222222222222222222222222222222222222222222222222222222",
  "3333333333333333333333333333333333333333333333333333333333333333",
  "4444444444444444444444444444444444444444444444444444444444444444",
  "5555555555555555555555555555555555555555555555555555555555555555",
  "6666666666666666666666666666666666666666666666666666666666666666",
];
