#!/usr/bin/env bash
# CKB devnet genesis-custom entrypoint. Mô hình hoá theo fiber/tests/deploy/init-dev-chain.sh
# (repo FNN v0.8.0) — tự viết, không copy demo-startup.
# PENDING (E3-4 live-boot): xác nhận create_type_id + thứ tự cell fiber khớp FNN devnet config,
# và bước faucet phân phối tiền cho từng node.
set -euo pipefail

DATA_DIR="${CKB_DATA_DIR:-/var/lib/ckb}"
# Lock arg của key miner+faucet (offckb ckb-miner-and-faucet.key). Dummy-pow mint block về key này
# (cellbase_maturity=0 ⇒ tiêu được ngay); orchestrator faucet phân phối cho node khi seed.
BA_ARG="${CKB_BA_ARG:-0xa1db2eef3f29f3ef6f86c8d2a0772c705c449f4a}"

if [ ! -f "$DATA_DIR/ckb.toml" ]; then
  ckb init -C "$DATA_DIR" -c dev --ba-arg "$BA_ARG" --force

  # RPC nghe mọi interface trong docker net (mặc định chỉ localhost) — vẫn KHÔNG bind ra host.
  sed -i 's|127.0.0.1:8114|0.0.0.0:8114|g' "$DATA_DIR/ckb.toml"
  # Bật IntegrationTest + Indexer (giữ các module mặc định).
  sed -i 's|"Debug"|"Debug", "IntegrationTest", "Indexer"|' "$DATA_DIR/ckb.toml"

  # Nhúng fiber-scripts vào genesis. Nguồn: repo FNN v0.8.0 tests/deploy/contracts (tải trong Dockerfile).
  cat >> "$DATA_DIR/specs/dev.toml" <<'EOF'

# --- fiber on-chain scripts (nhúng genesis) ---
[[genesis.system_cells]]
file = { file = "/fiber-scripts/auth" }
create_type_id = true
[[genesis.system_cells]]
file = { file = "/fiber-scripts/funding-lock" }
create_type_id = true
[[genesis.system_cells]]
file = { file = "/fiber-scripts/commitment-lock" }
create_type_id = true
[[genesis.system_cells]]
file = { file = "/fiber-scripts/simple_udt" }
create_type_id = true
[[genesis.system_cells]]
file = { file = "/fiber-scripts/xudt_rce" }
create_type_id = true
EOF
fi

ckb run -C "$DATA_DIR" --indexer &
CKB_PID=$!

# Chờ RPC lên rồi bật dummy miner.
for _ in $(seq 1 30); do
  if curl -sf -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","method":"get_tip_block_number","params":[],"id":1}' \
      http://localhost:8114 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
ckb miner -C "$DATA_DIR" &

wait "$CKB_PID"
