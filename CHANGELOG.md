# Changelog

From 0.9.1 on, the package is numbered after the FNN release it pins, the way
`@nervosnetwork/fiber-js` is; [`docs/releasing.md`](docs/releasing.md) has the rule. 1.0.0 and 1.1.0
predate it. Verification results only hold for the pinned FNN and `@ckb-ccc/fiber` versions recorded
in [`docs/scenario-catalog.md`](docs/scenario-catalog.md).

## 0.9.1

Pins FNN 0.9.1. The same code is released as `0.10.0-rc2`, under the `next` tag, pinned to FNN
0.10.0-rc2.

### Added

- **Releases follow Fiber.** Pushing a `v*` tag runs every check against the pinned FNN, then
  publishes to npm: a stable version to `latest`, a release candidate to `next`. A version that does
  not follow the pinned FNN is rejected by a unit test and before any `npm publish`.
- `fiber-lab doctor` prints the FNN version the project will run.
- **The lab drives the chain.** No miner runs by default; blocks are mined through `generate_block`
  only while something is waiting on-chain, so opening a channel takes about 3 s instead of 35 s and
  the chain stands still between steps. New seed actions `mine` and `advance_epochs`, and
  `chain.mining: auto` for an application that opens channels by itself.
- **Per-step expectations.** Any step can declare `expect`: payment status, failure reason and fee,
  channel balances (absolute or as a change), channel state, invoice status and on-chain capacity. A
  new `assert` action checks state at a point in the sequence. Results are recorded on each step.
- **Programmatic test-kit.** `setupScenario` accepts an inline scenario, and `ctx` gains `pay`,
  `payInvoice`, `newInvoice`, `openChannel`, `killNode`, `startNode`, `mine`, `advanceEpochs`,
  `balances` and `onchainCapacity`, plus `expectBalance`, `expectFee`, `expectInvoiceStatus` and
  `expectOnchainCapacity`. Everything lands in the run-log.
- **`fiber-lab test`** runs scenarios by name, `--all` or `--tag`, tears each one down and writes
  JUnit and HTML reports. Scenarios gain `tags`.
- **CI.** A reusable GitHub Action (`action.yml`), a CI workflow with an FNN version matrix, and a
  workflow publishing `linux/amd64` and `linux/arm64` images to GHCR.
- **Channel and payment lifecycle.** Hold invoices (`hold`, `settle_invoice`, `cancel_invoice`, and
  `ctx.newHoldInvoice`, `settleInvoice`, `cancelInvoice`), channel closes both cooperative and forced
  (`close_channel`, `ctx.closeChannel`), and connectivity faults (`disconnect_peer`, `connect_peer`,
  `pause_node`, `resume_node`). Seven new scenarios cover them.
- **Payments have four outcomes.** `waitFor: inflight` leaves a payment on its way, `await_payment`
  follows it, and a wait that runs out reports `timeout` instead of a failure. `ctx.pay` returns a
  `state` for the same four values.
- Step expectations gain `error` (a refusal the step must get), `peers`, TLC amounts in balance
  checks (`offered`, `received`) and `flags` on channel checks. New failure reason
  `invoice_cancelled`.
- **Usable from any codebase.** `fiber-test-lab/test-kit` imports with no configuration under Vitest and
  `node:test`; `.d.ts` files work under `Bundler` and `NodeNext`. `fiber-lab env`, `node`, `peer`,
  `chain` and `channel` let a test in any language describe a run and force states on it, with a Python
  example. A project can have its own `fiber-lab.config.json`, and a scenario with no seed is an
  environment for an application to run against. `fiber-lab doctor` checks the machine.
- `fiber-lab images` builds or pulls the images ahead of time, and the GitHub Action caches them.
- **Up to 5 nodes per scenario**, with a warning above 3; genesis now funds 6 accounts.
- A Docker-free unit suite: `npm run test:unit`. `npm run test:integration` runs the rest.
- `reset --images` deletes the images the lab has built.
- The run-log records the FNN and CKB versions each run used.

### Changed

- **FNN 0.9.1** (was 0.8.0). `fnnVersion` in `fiber-lab.config.ts` now really selects the release,
  and `FIBER_LAB_FNN_VERSION` overrides it.
- **One shared image per version**, tagged by a digest of the build context, instead of one set per
  run. Image builds are a separate `build_images` step.
- The CKB devnet starts before the FNN nodes, and genesis hashes are read from the running chain
  instead of being kept as constants.
- A channel counts as open only when both sides report it ready, and payments wait for gossip about
  every channel they could route over rather than only the target's.
- RPC calls time out instead of hanging on a frozen node.

### Removed

- The `push` channel field, which was accepted but never used; FNN's `open_channel` has no such
  parameter. Unknown keys are now a validation error everywhere.
- The `expect.reason` values no classifier could produce: `insufficient_inbound`,
  `amount_out_of_range`, `asset_mismatch`, `channel_not_ready` and `reserve_violation`. A scenario
  using one could only ever report a mismatch.

### Fixed

- `expect.reason` now reads payments that fail after being accepted (`failed_error`), which used to
  be reported as a mismatch.
- A scenario with a top-level `expect` and no payment is rejected instead of passing unchecked.
- Fractional amounts are validated, and converted exactly, instead of crashing mid-run.
- `new_invoice` honours `asset`.
- `reset` removes the run's working directory, and `reset --all` no longer rewrites runs that were
  already reset.
- The CKB image no longer depends on the Ubuntu 20.04 apt archive, which could fail a fresh build.
- `peer_offline` no longer misfires for a payer with no channel to the target.
- `cli/index.ts` is checked out with LF on Windows, so its shebang works.
- `npx fiber-lab` works on Windows when installed from the package.
- `up` returns only after gossip has reached every node, so an outside client can route at once.
- A restarted node keeps working: Docker gives it a new host port, which every endpoint now follows.
- Paying an invoice waits for gossip like a keysend does, instead of failing with `no path found`
  right after a multi-hop topology comes up.

## 1.1.0 — 2026-09-22

### Added

- **Run viewer.** `fiber-lab logs <run-id> --html [path]` writes a single self-contained HTML
  report, and `fiber-lab ui [--port] [--open]` serves the same report on `127.0.0.1` with live
  updates. The viewer shows a channel topology graph, a step timeline, and a filterable RPC table
  with latency bars. It is read-only: its only source is the run-log, so it never calls FNN RPC and
  never touches a container. See [Run viewer](README.md#run-viewer).
- **Live progress.** A run now records what it is doing while it does it — `docker_up` carries
  compose's own progress lines, `wait_ready` reports `n/m healthy`, `open_channel` reports its
  stage. The run-log is flushed to disk as the run proceeds, so `fiber-lab ui` fills in during an
  `up` instead of staying blank until it finishes.
- **`fiber-test-lab/report` entry point**, for rendering a run-log from your own code.
- `npm run ui` as a shortcut for `fiber-lab ui --open`.

### Changed

- **Run-log schema** gained three optional fields, so every run-log written before this version
  still parses: `RpcRecord.durationMs`, `StepRecord.channels` (each node's view of its channels
  after a balance-changing step) and `StepRecord.status`/`endedAt` (steps that are still running).
  A bracketed step now has an exact duration instead of one inferred from the next step's timestamp.
- `docker()` streams each line as it is printed rather than buffering until the process exits.

### Fixed

- **Restored the shebangs deleted from all three executables** (`topology/docker/ckb/entrypoint.sh`,
  `topology/docker/fnn/entrypoint.sh`, `cli/index.ts`). Without them the containers died with
  `exec format error`, which surfaced as `dependency failed to start: container ... is unhealthy`,
  so **every `fiber-lab up` failed between 14 Jul and this release**. `cli/index.ts` is the `bin`
  entry, so an installed `fiber-lab` was broken the same way. `test/shebang.test.ts` guards it now.
- A reset run no longer charges the hours it sat idle before cleanup to its last step, which made
  the timeline unreadable.

## 1.0.0 — 2026-07-15

First complete release: `fiber-lab up|seed|reset|logs|list`, the scenario schema with zod
validation, run-id isolation, the JSON run-log, the Vitest `test-kit`, and the built-in scenarios
listed in [`docs/scenario-catalog.md`](docs/scenario-catalog.md).
