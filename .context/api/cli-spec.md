---
type: cli_specification
version: 1.0
last_updated: 2026-07-04
tags: [cli, commander, commands]
---

# CLI Specification — fiber-lab


## General conventions

- Every command prints a human-readable result to stdout; add `--json` for machine-readable JSON (for CI).
- Exit code: `0` success, `1` config/validation error, `2` runtime error (docker/RPC), `3` expectation mismatch.
- Every command reads `fiber-lab.config.ts` (global config) unless overridden by a flag.

## Commands

### `fiber-lab up <scenario> [--json] [--keep]`
Build the topology for a scenario.
- `<scenario>` — a file name under `topology/scenarios/` (no `.yaml` extension needed)
- `--keep` — do not tear down automatically on error (for debugging)
- **What it does:** validate the YAML → generate a run-id → generate dynamic compose → `docker compose up` → wait for nodes to be ready → genesis pre-fund (no runtime faucet) → open channels per `channels` → wait for channels to be READY.
- **Output:** prints the `run-id` (used by later commands). `--json` → `{ runId, network, nodes: [...] }`.
- **Errors:** bad schema → exit 1; docker/RPC error → exit 2, the run-log records the cause.

### `fiber-lab seed <scenario> [--run <run-id>] [--json]`
Run the scenario's `seed` steps against a running run.
- Without `--run` → uses the most recent run of that scenario.
- **What it does:** executes `SeedStep[]` sequentially (send_payment, new_invoice, kill_node, wait...), recording each step to the run-log.
- **Output:** the result of each step. `--json` → an array of `StepRecord`.

> Note: `up` can run the seed automatically if the scenario has a `seed` section. The standalone `seed` command is for re-running or manually controlling it.

### `fiber-lab reset [run-id] [--all]`
Teardown and cleanup.
- `reset <run-id>` — cleans up exactly one run (docker down + remove network + remove port map).
- `reset --all` (or `reset` with no argument) — cleans up EVERY Test Lab run.
- **Output:** the list of runs that were cleaned up.
- **Guarantee:** no leftover containers/networks — even if a prior `up` failed partway through.

### `fiber-lab logs <run-id> [--json] [--rpc]`
Print the run-log.
- Default: a summary of steps + status.
- `--rpc` — print every raw RPC call (method/params/response/error) in full — for deep debugging.
- `--json` — print the raw run-log JSON file.

### `fiber-lab list [--json]`
- Lists the available scenarios (reading `topology/scenarios/`) with their `description`.
- Lists the currently running runs (reading `.fiber-lab/runs/`) with their status.

## Shared use with test-kit (Vitest)

test-kit does not call the CLI through a shell — it imports `lib/` directly to get a run's context:
```typescript
import { setupScenario } from "fiber-test-lab/test-kit"
import { expectPaymentFails } from "fiber-test-lab/test-kit"

const ctx = await setupScenario("insufficient-capacity")   // ~ up + seed
await expectPaymentFails(ctx, ctx.lastPaymentId, "insufficient_outbound")
await ctx.reset()
```
`ctx` includes: `runId`, a function to call RPC by node name, `lastPaymentId`, `reset()`.
