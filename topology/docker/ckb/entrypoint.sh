#!/usr/bin/env bash
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

if [ "${CKB_AUTO_MINE:-false}" = "true" ]; then
  until bash /usr/local/bin/flab-ckb-rpc-ping.sh 2>/dev/null; do sleep 1; done
  ckb miner -C "$DATA_DIR" &
fi

wait "$CKB_PID"
