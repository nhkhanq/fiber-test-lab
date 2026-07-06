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

  cat > "$DATA_DIR/specs/dev.toml" <<'EOF'
name = "ckb_dev"

[genesis]
version = 0
parent_hash = "0x0000000000000000000000000000000000000000000000000000000000000000"
timestamp = 0
compact_target = 0x20010000
uncles_hash = "0x0000000000000000000000000000000000000000000000000000000000000000"
nonce = "0x0"

[genesis.genesis_cell]
message = "ckb_dev"

[genesis.genesis_cell.lock]
code_hash = "0x0000000000000000000000000000000000000000000000000000000000000000"
args = "0x"
hash_type = "data"

[[genesis.system_cells]]
file = { bundled = "specs/cells/secp256k1_blake160_sighash_all" }
create_type_id = true
capacity = 100_000_0000_0000
[[genesis.system_cells]]
file = { bundled = "specs/cells/dao" }
create_type_id = true
capacity = 16_000_0000_0000
[[genesis.system_cells]]
file = { bundled = "specs/cells/secp256k1_data" }
create_type_id = false
capacity = 1_048_617_0000_0000
[[genesis.system_cells]]
file = { bundled = "specs/cells/secp256k1_blake160_multisig_all" }
create_type_id = true
capacity = 100_000_0000_0000
[[genesis.system_cells]]
file = { file = "/fiber-scripts/auth" }
create_type_id = false
capacity = 200_000_0000_0000
[[genesis.system_cells]]
file = { file = "/fiber-scripts/funding-lock" }
create_type_id = false
capacity = 200_000_0000_0000
[[genesis.system_cells]]
file = { file = "/fiber-scripts/commitment-lock" }
create_type_id = false
capacity = 200_000_0000_0000
[[genesis.system_cells]]
file = { file = "/fiber-scripts/simple_udt" }
create_type_id = false
capacity = 200_000_0000_0000
[[genesis.system_cells]]
file = { file = "/fiber-scripts/xudt_rce" }
create_type_id = false
capacity = 200_000_0000_0000

[genesis.system_cells_lock]
code_hash = "0x0000000000000000000000000000000000000000000000000000000000000000"
args = "0x"
hash_type = "data"

[[genesis.dep_groups]]
name = "secp256k1_blake160_sighash_all"
files = [
  { bundled = "specs/cells/secp256k1_data" },
  { bundled = "specs/cells/secp256k1_blake160_sighash_all" },
]
[[genesis.dep_groups]]
name = "secp256k1_blake160_multisig_all"
files = [
  { bundled = "specs/cells/secp256k1_data" },
  { bundled = "specs/cells/secp256k1_blake160_multisig_all" },
]

[genesis.bootstrap_lock]
code_hash = "0x0000000000000000000000000000000000000000000000000000000000000000"
args = "0x"
hash_type = "type"

[[genesis.issued_cells]]
capacity = 20_000_000_000_00000000
lock.code_hash = "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8"
lock.args = "0xc8328aabcd9b9e8e64fbc566c4385c3bdeb219d7"
lock.hash_type = "type"

[params]
initial_primary_epoch_reward = 1_917_808_21917808
secondary_epoch_reward = 613_698_63013698
max_block_cycles = 10_000_000_000
cellbase_maturity = 0
primary_epoch_reward_halving_interval = 8760
epoch_duration_target = 80
genesis_epoch_length = 10
permanent_difficulty_in_dummy = true
starting_block_limiting_dao_withdrawing_lock = 0

[params.hardfork]
ckb2023 = 0

[pow]
func = "Dummy"
EOF

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
