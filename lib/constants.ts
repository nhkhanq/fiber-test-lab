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
