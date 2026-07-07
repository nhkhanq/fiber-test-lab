#!/usr/bin/env bash
# CKB devnet genesis khớp fiber devnet chuẩn (mô hình theo tests/nodes/deployer/dev.toml, tự viết).
# fiber cells create_type_id=false ⇒ FNN devnet đọc scripts theo data-hash từ chain spec (config FNN
# devnet không có scripts section, chỉ `fiber.chain: dev.toml`). message="ckb_dev" ⇒ genesis deterministic.
# Account faucet nạp sẵn 20 tỷ CKB (privkey d00c06bfd800d27397002dca6fb0993d5ba6399b4238b2f29ee9deb97593d2bc).
set -euo pipefail

DATA_DIR="${CKB_DATA_DIR:-/var/lib/ckb}"
FAUCET_ARG="0xc8328aabcd9b9e8e64fbc566c4385c3bdeb219d7"

if [ ! -f "$DATA_DIR/ckb.toml" ]; then
  ckb init -C "$DATA_DIR" -c dev --ba-arg "$FAUCET_ARG" --force
  cp /flab/dev.toml "$DATA_DIR/specs/dev.toml"
  sed -i 's|127.0.0.1:8114|0.0.0.0:8114|g' "$DATA_DIR/ckb.toml"
  sed -i 's|"Debug"|"Debug", "IntegrationTest", "Indexer"|' "$DATA_DIR/ckb.toml"
fi

ckb run -C "$DATA_DIR" --indexer &
CKB_PID=$!

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
