#!/usr/bin/env bash
set -euo pipefail

RPC_PORT="${FNN_RPC_PORT:-8227}"
export RPC_LISTENING_ADDR="$(hostname -i | awk '{print $1}'):${RPC_PORT}"

exec fnn "$@"
