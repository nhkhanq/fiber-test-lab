#!/usr/bin/env bash
# FNN bind RPC vào IP private của container (172.x, is_private) → qua check is_public_addr của FNN,
# không cần biscuit auth, vẫn reachable trong docker network + qua port-map.
set -euo pipefail

RPC_PORT="${FNN_RPC_PORT:-8227}"
export RPC_LISTENING_ADDR="$(hostname -i | awk '{print $1}'):${RPC_PORT}"

exec fnn "$@"
