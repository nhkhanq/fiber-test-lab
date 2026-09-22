# Changelog

Versions follow [semver](https://semver.org/). Verification results only hold for the pinned FNN
and `@ckb-ccc/fiber` versions recorded in [`docs/scenario-catalog.md`](docs/scenario-catalog.md).

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
