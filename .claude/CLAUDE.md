# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status: pre-implementation

This repo currently contains **only** `LICENSE` and the `.context/` spec directory — there is no code, `package.json`, or tooling yet. Almost all "how to build/test/run" answers below describe the **planned** design, not something you can run today. When you start implementing, scaffold against the spec in `.context/` and update this file with the real commands.

## Read the spec first

`.context/` is the Single Source of Truth for what this project is meant to be. **Read `.context/INDEX.md` before doing anything** — it maps the whole context tree. The docs are written in Vietnamese. Key files:

- `.context/architecture/system-design.md` — the most detailed and authoritative doc; tech stack, topology, data flow, repo layout. Read most carefully.
- `.context/api/cli-spec.md` — full CLI command spec (flags, output, exit codes).
- `.context/data-dictionary/scenario-schema.md` — YAML scenario schema + JSON run-log schema (this project has no database).
- `.context/business-rules/scenario-rules.md` — the invariants (BR-* rules) that implementation must satisfy.
- `.context/processes/decisions-log.md` — human-confirmed decisions. **Only append here after the human explicitly confirms a decision in conversation** — never invent entries.
- `.context/processes/definition-of-done.md` — the self-verify checklist to run at the end of each coding session.

## What this project is

**Fiber Test Lab** — a fully-local, one-command test environment for Fiber Network (a payment-channel layer on CKB blockchain). It lets developers reproduce deterministic, controllable payment/routing failure scenarios (direct channel, multi-hop route, insufficient capacity, expired invoice, peer offline) that are otherwise impossible to force reliably on public testnet. It is **developer tooling** (a CLI + YAML scenarios + a `test-kit` assertion library) — not a Fiber node, wallet, or end-user app.

Built for the "Gone in 60ms" Fiber Network hackathon, Category 2 (Node/Routing/Diagnostics).

## Planned architecture

Flow of `fiber-lab up <scenario>`:
1. Read `topology/scenarios/<name>.yaml` → validate with **zod before touching Docker** (bad schema → exit 1, no containers created).
2. Generate a unique **run-id**; all resources are namespaced by it.
3. `topology/compose.template.ts` generates a docker-compose dynamically (N real FNN node containers + 1 `offckb` CKB devnet), on an isolated network `flab_<run-id>`.
4. `docker compose up` → poll each node to READY (`get_node_info`), faucet CKB, open channels per the `channels` block, poll channels to READY.
5. Write a JSON run-log to `.fiber-lab/runs/<run-id>.json`.

Layer boundaries:
- `cli/` — commander handlers, kept **thin**: parse args, delegate to `lib/`. All access to node clusters goes through the CLI so state is logged and resettable.
- `lib/` — core logic: `fiber/client.ts` (wraps `@ckb-ccc/fiber` RPC), `docker/orchestrator.ts` (compose gen + up/down + run-id isolation), `scenario/loader.ts` (YAML + zod), `scenario/seeder.ts` (executes seed steps), `runlog/store.ts` (JSON run-log).
- `topology/` — scenario YAML files + dynamic compose template.
- `test-kit/` — Vitest assertion helpers (`expectPaymentSucceeds`, `expectPaymentFails`, `expectChannelState`) that import `lib/` directly (not via shell) and **poll** RPC with interval/timeout, since FNN pushes no events.

Two-tier config: per-scenario settings live in each `scenarios/<name>.yaml`; global settings (poll interval/timeout, network prefix, pinned FNN image, `keepRunOnFailure`) live in `fiber-lab.config.ts`.

## Planned stack & commands (once scaffolded)

- **TypeScript strict**, run directly via `tsx` (no separate build step). Package manager: `npm` (single package, no workspace). Test framework: **Vitest**.
- CLI (planned): `fiber-lab up|seed|reset|logs|list`. Every command supports `--json` for CI. Exit codes: `0` ok, `1` config/validation error, `2` runtime (docker/RPC) error, `3` expectation mismatch.
- **Pinned versions matter**: FNN binary image and `@ckb-ccc/fiber` must be version-pinned (in `package.json` and `docs/scenario-catalog.md`); verify results are only valid for the pinned versions.

## Non-negotiable invariants (from business-rules)

When writing or reviewing code, these must hold:
- Validate every YAML input with **zod before any Docker call**; fail fast with a clear message naming the bad field.
- **Never hardcode ports or container names** — derive everything from the run-id. Two parallel `up` runs must not share network/containers.
- Containers do **not** bind ports to the host by default — they listen only inside `flab_<run-id>`. Temporary port maps are opened only when test-kit (outside Docker) needs RPC, and closed on reset.
- **Everything must be cleanable via `fiber-lab reset`** — no leftover containers/networks, even when `up` fails partway (auto-teardown unless `--keep`). `reset` marks the run-log `status: reset` but does not delete the run-log file.
- **Log every RPC call** (method/params/response/error, including successes) to the run-log — after reset the containers are gone, so the run-log is the only debugging record.
- **Determinism is a requirement**: same scenario + same pinned versions ⇒ same result across runs. A flaky test (usually a missing wait-for-READY) is a Test Lab bug, not acceptable behavior.

## Code conventions

- Functions `camelCase`; types/interfaces `PascalCase`.
- Keep CLI handlers thin; put logic in `lib/`.
- Max 3 nodes per scenario (machine-resource limit) unless deliberately overridden in global config with a warning.
