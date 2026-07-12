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

// Privkey pre-fund sẵn trong genesis (dev.toml issued_cells) — gán theo node index. CHỈ devnet, không bí mật.
// Mỗi node có 10 tỷ CKB từ genesis ⇒ mở channel ngay, không cần faucet runtime.
export const DEV_FUNDED_KEYS = [
  "1111111111111111111111111111111111111111111111111111111111111111",
  "2222222222222222222222222222222222222222222222222222222222222222",
  "3333333333333333333333333333333333333333333333333333333333333333",
];
