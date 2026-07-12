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
export const SCENARIOS_DIR = "topology/scenarios";

export const CKB_VERSION = "0.207.0"; // nervos/ckb devnet, aligned with offckb 0.4.7 genesis
export const CKB_IMAGE = `nervos/ckb:v${CKB_VERSION}`;

export const CKB_RPC_PORT = 8114;
export const FNN_RPC_PORT = 8227; // FNN JSON-RPC (node_info/open_channel/...)
export const FNN_P2P_PORT = 8228; // FNN gossip/p2p

export const CKB_SERVICE = "ckb";

export const DOCKER_BUILD_CONTEXT = "topology/docker";
export const FNN_DOCKERFILE = "fnn.Dockerfile";
export const CKB_DOCKERFILE = "ckb.Dockerfile";

export const FNN_BASE_DIR = "/fiber-node";
export const DEV_CHAIN_SPEC = "/flab/dev.toml";
export const FNN_SECRET_KEY_PASSWORD = "flab-dev";

export const FNN_GOSSIP_NETWORK_INTERVAL_MS = 2000;
export const FNN_GOSSIP_STORE_INTERVAL_MS = 2000;

export const SIMPLE_UDT_CODE_HASH = "0xe1e354d6d643ad42724d40967e334984534e0367405c5ae42a9d7d63d77df419";
export const SIMPLE_UDT_DEP = {
  txHash: "0xd2beb4f3ff33abce80bdfac6df1afbc087f6b702eb4cd7cdda9272dfcde72834",
  index: 8,
} as const;
export const SECP256K1_DEP_GROUP = {
  txHash: "0x0a60a87b186f3a6f34545c3eebf0318ecd2cadc9db60b597fa93dfb594641d07",
  index: 0,
} as const;
export const UDT_ASSET = "RUSD" as const; // scenario asset name mapped to simple_udt

export const DEV_FUNDED_KEYS = [
  "1111111111111111111111111111111111111111111111111111111111111111",
  "2222222222222222222222222222222222222222222222222222222222222222",
  "3333333333333333333333333333333333333333333333333333333333333333",
];
