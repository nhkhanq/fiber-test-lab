// Exit code chuẩn CLI (cli-spec §Quy ước chung).
export const EXIT_CODES = {
  ok: 0,
  validation: 1, // lỗi cấu hình / schema
  runtime: 2, // lỗi docker / RPC
  expectation: 3, // expect không khớp
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export const SHANNON_PER_CKB = 100_000_000n;

// Verify tay ở E0: node auto-accept min funding = 100 CKB; mỗi bên reserve ~99 CKB.
export const MIN_CHANNEL_CAPACITY_CKB = 100;
export const MIN_CHANNEL_RESERVE_CKB = 99;

export const RUNS_DIR = ".fiber-lab/runs";
export const WORK_DIR = ".fiber-lab/work"; // compose file materialize hoá theo run-id
export const SCENARIOS_DIR = "topology/scenarios";

// --- Hạ tầng ghim cứng (deterministic — xem decisions-log 2026-07-05 + docs/hands-on/e3-3-infra-research.md) ---
// fiber-scripts (funding-lock/commitment-lock/...) lấy từ chính repo FNN tag v0.8.0 (tests/deploy/contracts)
// → cùng version FNN đã pin, không build-from-source, không phụ thuộc offckb.
export const CKB_VERSION = "0.207.0"; // nervos/ckb devnet, khớp genesis offckb 0.4.7
export const CKB_IMAGE = `nervos/ckb:v${CKB_VERSION}`;

// Cổng nội bộ container — KHÔNG bind ra host mặc định (system-design §9).
export const CKB_RPC_PORT = 8114;
export const FNN_RPC_PORT = 8227; // FNN JSON-RPC (node_info/open_channel/...)
export const FNN_P2P_PORT = 8228; // FNN gossip/p2p

// Tên service CKB trong compose (DNS nội bộ ổn định, không gắn run-id — xem compose.template.ts).
export const CKB_SERVICE = "ckb";

// Build context + Dockerfile (đường dẫn tương đối gốc repo).
export const DOCKER_BUILD_CONTEXT = "topology/docker";
export const FNN_DOCKERFILE = "fnn.Dockerfile";
export const CKB_DOCKERFILE = "ckb.Dockerfile";

// FNN per-node: base dir mount trong container, chain spec baked sẵn, password mã hoá key (devnet).
export const FNN_BASE_DIR = "/fiber-node";
export const DEV_CHAIN_SPEC = "/flab/dev.toml";
export const FNN_SECRET_KEY_PASSWORD = "flab-dev";

// Ép gossip lan nhanh trên devnet 1 host — mặc định FNN 60s/20s làm multi-hop route chờ lâu, phi tất định
// (E5-2: alice học channel bob→charlie chậm > timeout). Không có bootnode như demo-startup nên phải tự tăng tốc.
export const FNN_GOSSIP_NETWORK_INTERVAL_MS = 2000;
export const FNN_GOSSIP_STORE_INTERVAL_MS = 2000;

// UDT (E8-4): scenario asset "RUSD" ánh xạ sang script simple_udt của devnet reimplement.
// Giá trị TẤT ĐỊNH theo dev.toml + CKB v0.207.0 đã pin — derive lại (hash binary + quét genesis) nếu đổi genesis.
// code_hash = ckb-blake2b của binary simple_udt; cell_dep + secp256k1 dep_group lấy từ genesis block 0.
export const SIMPLE_UDT_CODE_HASH = "0xe1e354d6d643ad42724d40967e334984534e0367405c5ae42a9d7d63d77df419";
export const SIMPLE_UDT_DEP = {
  txHash: "0xd2beb4f3ff33abce80bdfac6df1afbc087f6b702eb4cd7cdda9272dfcde72834",
  index: 8,
} as const;
export const SECP256K1_DEP_GROUP = {
  txHash: "0x0a60a87b186f3a6f34545c3eebf0318ecd2cadc9db60b597fa93dfb594641d07",
  index: 0,
} as const;
export const UDT_ASSET = "RUSD" as const; // tên asset trong scenario ↔ simple_udt

// Privkey pre-fund sẵn trong genesis (dev.toml issued_cells) — gán theo node index. CHỈ devnet, không bí mật.
// Mỗi node có 10 tỷ CKB từ genesis ⇒ mở channel ngay, không cần faucet runtime.
export const DEV_FUNDED_KEYS = [
  "1111111111111111111111111111111111111111111111111111111111111111",
  "2222222222222222222222222222222222222222222222222222222222222222",
  "3333333333333333333333333333333333333333333333333333333333333333",
];
