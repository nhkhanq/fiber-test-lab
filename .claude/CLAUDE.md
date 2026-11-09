# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status: implemented

The CLI, the scenario engine, the test-kit and the run viewer are all built and working. The
commands below are real — run them. `.context/` remains the spec; where code and spec disagree,
fix one of them deliberately rather than letting them drift.

## Read the spec first

`.context/` is the Single Source of Truth for what this project is meant to be. **Read `.context/INDEX.md` before doing anything** — it maps the whole context tree. Key files:

- `.context/architecture/system-design.md` — the most detailed and authoritative doc; tech stack, topology, data flow, repo layout. Read most carefully.
- `.context/api/cli-spec.md` — full CLI command spec (flags, output, exit codes).
- `.context/data-dictionary/scenario-schema.md` — YAML scenario schema + JSON run-log schema (this project has no database).
- `.context/business-rules/scenario-rules.md` — the invariants (BR-* rules) that implementation must satisfy.
- `.context/processes/decisions-log.md` — human-confirmed decisions. **Only append here after the human explicitly confirms a decision in conversation** — never invent entries.
- `.context/processes/definition-of-done.md` — the self-verify checklist to run at the end of each coding session.

## What this project is

**Fiber Test Lab** — a fully-local, one-command test environment for Fiber Network (a payment-channel layer on CKB blockchain). It lets developers reproduce deterministic, controllable payment/routing failure scenarios (direct channel, multi-hop route, insufficient capacity, expired invoice, peer offline) that are otherwise impossible to force reliably on public testnet. It is **developer tooling** (a CLI + YAML scenarios + a `test-kit` assertion library) — not a Fiber node, wallet, or end-user app.

Built for the "Gone in 60ms" Fiber Network hackathon, Category 2 (Node/Routing/Diagnostics).

## Architecture

Flow of `fiber-lab up <scenario>`:
1. Read `topology/scenarios/<name>.yaml` → validate with **zod before touching Docker** (bad schema → exit 1, no containers created).
2. Generate a unique **run-id**; all resources are namespaced by it.
3. `topology/compose.template.ts` generates a docker-compose dynamically (N real FNN node containers + 1 CKB devnet container built from a genesis with the fiber scripts baked in), on an isolated network `flab_<run-id>`.
4. `docker compose up` the devnet first and read its genesis, then the FNN nodes → poll each container to healthy, open channels per the `channels` block, mining until both sides reach `ChannelReady`, run the seed steps.
5. Write a JSON run-log to `.fiber-lab/runs/<run-id>.json` — **flushed as the run proceeds**, not only at the end, so `fiber-lab ui` can follow a run live.

Layer boundaries:
- `cli/` — commander handlers, kept **thin**: parse args, delegate to `lib/`. All access to node clusters goes through the CLI so state is logged and resettable.
- `lib/` — core logic: `fiber/client.ts` (wraps `@ckb-ccc/fiber` RPC), `docker/orchestrator.ts` (compose gen + up/down + run-id isolation), `scenario/loader.ts` (YAML + zod), `scenario/runtime.ts` (every action a scenario can take, used by both the seed and the test-kit), `ckb/chain.ts` (mining, epochs, indexer sync), `runlog/store.ts` (JSON run-log).
- `topology/` — scenario YAML files + dynamic compose template.
- `test-kit/` — Vitest assertion helpers (`expectPaymentSucceeds`, `expectPaymentFails`, `expectChannelState`) that import `lib/` directly (not via shell) and **poll** RPC with interval/timeout (`subscribe_store_changes` is available via `subscribePayments` for the event-driven path).
- `lib/report/` — the run viewer: `model.ts` (a pure `RunLog -> ReportModel` transform), `render.ts` (one self-contained HTML document, vanilla + inline SVG, no bundler), `server.ts` (the loopback-only `fiber-lab ui` server). **Read-only by rule:** it reads the run-log and never calls FNN RPC, never imports the orchestrator — see the 2026-09-22 entries in `decisions-log.md`.

Two-tier config: per-scenario settings live in each `scenarios/<name>.yaml`; global settings (poll interval/timeout, network prefix, pinned FNN image, `keepRunOnFailure`) live in `fiber-lab.config.ts`.

## Stack & commands

- **TypeScript strict**, run directly via `tsx` — **there is no build step and no `dist`** for anything that runs: `files:` ships source, and `bin/fiber-lab.mjs` and the `entry.mjs` files register `tsx` and import it. Keep it that way; it is why the viewer is vanilla rather than a bundled framework app. The one generated output is `types/`, the `.d.ts` files consuming projects compile against, emitted by `prepare`.
- Package manager: `npm` (single package, no workspace). Test framework: **Vitest**.
- CLI: `fiber-lab up|seed|test|images|env|node|peer|chain|channel|doctor|reset|logs|list|ui`. Every command supports `--json` for CI. Exit codes: `0` ok, `1` config/validation error, `2` runtime (docker/RPC) error, `3` expectation mismatch.
- Day to day:
  - `npm run lab -- <command>` — the CLI from source (e.g. `npm run lab -- up direct-channel`)
  - `npm run ui` — the run viewer, opens a browser
  - `npm run typecheck` — `tsc --noEmit`
  - `npm run test:unit` — no Docker, seconds. Run this first.
  - `npm run test:integration` — real containers, minutes. `npm test` runs both.
  - `npm run test:consumer` — installs the packed library into an empty project and uses it as an outsider would. No Docker.
  - `npm run lab -- test --all` — every YAML scenario end to end.
- **Pinned versions matter**: the FNN binary and `@ckb-ccc/fiber` are version-pinned (in `package.json` and `docs/scenario-catalog.md`); verify results are only valid for the pinned versions.
- **Every package release pins one FNN release** (BR-DET-003); `npm run release:set -- <version> <fnn>` changes both together. `docs/releasing.md` has the rule and the release steps; pushing a `v*` tag publishes to npm.

## Non-negotiable invariants (from business-rules)

When writing or reviewing code, these must hold:
- Validate every YAML input with **zod before any Docker call**; fail fast with a clear message naming the bad field.
- **Never hardcode ports or container names** — derive everything from the run-id. Two parallel `up` runs must not share network/containers.
- Containers do **not** bind ports to the host by default — they listen only inside `flab_<run-id>`. Temporary port maps are opened only when test-kit (outside Docker) needs RPC, and closed on reset.
- **Everything must be cleanable via `fiber-lab reset`** — no leftover containers/networks, even when `up` fails partway (auto-teardown unless `--keep`). `reset` marks the run-log `status: reset` but does not delete the run-log file.
- **Log every RPC call** (method/params/response/error, including successes) to the run-log — after reset the containers are gone, so the run-log is the only debugging record.
- **Determinism is a requirement**: same scenario + same pinned versions ⇒ same result across runs. A flaky test (usually a missing wait-for-READY) is a Test Lab bug, not acceptable behavior.
- **The CLI is the only control surface.** The viewer, and anything else added later, must not drive a cluster directly; a GUI action would otherwise never reach a run-log.
- **Shell scripts and `bin` entries must keep their shebang.** An automated comment-strip once removed all three at once and broke every `up` for two months (`exec format error` surfaces only as an unhealthy container). `test/shebang.test.ts` guards this.

## Code conventions

- Functions `camelCase`; types/interfaces `PascalCase`.
- Keep CLI handlers thin; put logic in `lib/`.
- Scenarios above 3 nodes print a warning (machine-resource limit). `maxNodesPerScenario: 5` in `fiber-lab.config.ts` is the deliberate override.
- In the default `manual` chain mode no miner runs: anything that waits on-chain must mine while it waits (`chain.mineUntil`).
