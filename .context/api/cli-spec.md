---
type: cli_specification
version: 1.0
last_updated: 2026-09-22
tags: [cli, commander, commands]
---

# CLI Specification — fiber-lab


## General conventions

- Every command prints a human-readable result to stdout; add `--json` for machine-readable JSON (for CI).
- Exit code: `0` success, `1` config/validation error, `2` runtime error (docker/RPC), `3` expectation mismatch.
- Every command reads its configuration in this order, later layers winning: the shipped `fiber-lab.config.ts`, `fiber-lab.config.json` in the working directory, `FIBER_LAB_*` environment variables, then a flag.

## Commands

### `fiber-lab up <scenario> [--json] [--keep]`
Build the topology for a scenario.
- `<scenario>` — a file name under `topology/scenarios/` (no `.yaml` extension needed)
- `--keep` — do not tear down automatically on error (for debugging)
- **What it does:** validate the YAML → generate a run-id → build or reuse the versioned images → start the CKB devnet → read its genesis → start the FNN nodes → open channels per `channels`, mining until both sides report READY → run the seed.
- **Output:** prints the `run-id` (used by later commands). `--json` → `{ runId, network, nodes: [...], environment }`, where `environment` is what `fiber-lab env --json` prints. `up` returns once gossip has reached every node.
- **Errors:** bad schema → exit 1; docker/RPC error → exit 2, the run-log records the cause.

### `fiber-lab seed <scenario> [--run <run-id>] [--json]`
Run the scenario's `seed` steps against a running run.
- Without `--run` → uses the most recent run of that scenario.
- **What it does:** executes `SeedStep[]` sequentially (send_payment, new_invoice, kill_node, wait...), recording each step to the run-log. Expectations are not evaluated and `assert` steps are skipped: they describe the first run.
- **Output:** the result of each step. `--json` → an array of `StepRecord`.

> Note: `up` can run the seed automatically if the scenario has a `seed` section. The standalone `seed` command is for re-running or manually controlling it.

### `fiber-lab reset [run-id] [--all] [--images]`
Teardown and cleanup.
- `reset <run-id>` — cleans up exactly one run (docker down + remove network + remove port map + remove its working directory).
- `reset --all` (or `reset` with no argument) — cleans up EVERY Test Lab run.
- `--images` — also deletes the images the lab has built (they are shared by runs, so a normal reset keeps them).
- **Output:** the list of runs that were cleaned up.
- **Guarantee:** no leftover containers/networks — even if a prior `up` failed partway through.

### `fiber-lab test [scenarios...] [--all] [--tag <tag...>] [--junit <path>] [--html] [--keep] [--json]`
Run scenarios one at a time, tear each one down, and report the results.
- Selection: scenario names or paths, `--all` for every built-in scenario, `--tag` for the built-in scenarios carrying any of the tags. At least one is required. Everything selected is validated before the first scenario starts.
- `--junit <path>` — also write a JUnit XML report.
- `--html` — write each run's report to `.fiber-lab/runs/<run-id>.html`.
- `--keep` — keep the containers of a scenario that does not pass.
- **Exit code:** `0` all passed, `3` at least one mismatch, `2` at least one could not run (takes priority), `1` nothing valid was selected.

### `fiber-lab env [run-id] [--json] [--dotenv]`
Print what a client in any language needs to use a run, read from its run-log: each node's RPC endpoint, pubkey, lock and funded devnet key, and the CKB endpoint and genesis hashes. Defaults to the most recent run still up.

### Control commands
`fiber-lab node <kill|start|pause|resume> <node>`, `fiber-lab peer <disconnect|connect> <from> <to>`, `fiber-lab chain <tip|mine|epochs> [count]`, `fiber-lab channel <open|close> <from> <to> [capacity] [--force]`. All take `[--run <run-id>] [--json]` and default to the most recent run still up.
- They force a state on a live run from outside it, so a test in any language can do what the seed actions and the test-kit do.
- Each attaches to the run through its run-log, acts through the same runtime, and records the same steps. A later command sees what an earlier one did (a paused node stays offline across processes).
- **Exit code:** `1` bad arguments or no such run, `2` the action failed.

### `fiber-lab doctor [--json]`
Check Node.js, the Docker daemon and Compose. Exit code `2` if any is missing.
### `fiber-lab images [--json]`
Build or pull the images for the configured versions without starting anything. `--json` prints their names.

### `fiber-lab logs <run-id> [--json] [--rpc] [--html [path]]`
Print the run-log.
- Default: a summary of steps + status.
- `--rpc` — print every raw RPC call (method/params/response/error) in full — for deep debugging.
- `--json` — print the raw run-log JSON file.
- `--html [path]` — write a **single self-contained** HTML report (topology graph, step timeline, filterable RPC table) instead of printing. Never a folder: all data and styles are inlined so the file opens over `file://` and can be archived as a CI artifact. Defaults to `.fiber-lab/runs/<run-id>.html`. Read-only; generating it touches no container and issues no RPC.

### `fiber-lab ui [--port <n>] [--open] [--json]`
Serve the run viewer over HTTP on `127.0.0.1` (never `0.0.0.0`), reading `.fiber-lab/runs/`.
- Lists every run, drills into one, and re-reads the run-log on an interval so a run still being built by `up` fills in live.
- Read-only by design: the server never calls FNN RPC and never imports the orchestrator — the CLI stays the only way to drive a cluster (see decisions-log, 2026-09-22).
- `--port` — defaults to an ephemeral free port, printed on start.
- `--open` — open the browser automatically.
- Exit code 2 if the port is taken.

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
`ctx` includes: `runId`, a function to call RPC by node name, `lastPaymentId`, `reset()`, and methods that act on the run and land in its run-log: `pay`, `payInvoice`, `awaitPayment`, `newInvoice`, `newHoldInvoice`, `settleInvoice`, `cancelInvoice`, `openChannel`, `closeChannel`, `disconnectPeer`, `connectPeer`, `killNode`, `startNode`, `pauseNode`, `resumeNode`, `mine`, `advanceEpochs`, `balances`, `onchainCapacity`. `setupScenario` also accepts a scenario object, validated by the same rules as a file.
