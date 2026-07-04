---
type: backlog
version: 1.0
last_updated: 2026-07-04
tags: [backlog, tasks, tickets]
---

# Backlog — Fiber Test Lab

> Each item = one independent ticket, small enough to finish in ≤ half a day. Estimate in story points (1 = ~1-2h, 2 = ~half day, 3 = ~1 day).
> Order in this file = suggested order to pull into "Ready". Epic E0 must be done before writing any code.

---

## EPIC E0 — Hands-on Foundation (required before any coding)

> Reworked after reading official docs: the fastest hands-on path is to clone `fiber-demo-startup`
> (already dockerizes CKB dev chain + multiple FNN nodes) instead of installing everything from scratch.
> `fnn-cli` uses subcommands: `fnn-cli info`, `fnn-cli peer list_peers`, `fnn-cli channel list_channels`.

**E0-1** · Clone `fiber-demo-startup` (demo-0.8), `docker compose up`, all nodes healthy · est 2
- AC: local CKB dev chain + Fiber nodes running via docker compose; can reach a node.

**E0-2** · Follow `fiber.world/docs/quick-start` (run-a-node, basic-transfer) hands-on · est 2
- AC: read + run the official quick-start against the local nodes; understand the flow.

**E0-3** · Manually open a channel + send a payment + close, via `fnn-cli` / demo app · est 2
- AC: one payment sent end-to-end; record the exact request/response of each RPC.

**E0-4** · Write an "RPC notebook" from `fiber.world/docs/api-reference` + real responses · est 1
- AC: note file listing the core methods (node info, open/list/close channel, new_invoice, send_payment) with real params/responses.

**E0-5** · Force one error (send over capacity) + record raw error response · est 1
- AC: at least one real raw error response captured to map against `ErrorCategory`.

---

## EPIC E1 — Adapt fiber-demo-startup base (checkpoint: end of Day 5)

> No longer "dockerize from scratch" — the demo-startup compose already runs multi-node + CKB dev chain.
> This epic = understand it, verify license, parametrize it for Test Lab.

**E1-1** · Check `fiber-demo-startup` license allows fork/build-on-top · est 1
- AC: license confirmed; record decision in `decisions-log.md` (closes open question).

**E1-2** · Read + document the demo-startup compose (services, networks, ports, fund flow) · est 2
- AC: short note mapping each service + how channels/funds are set up manually today.

**E1-3** · Reduce/parametrize compose to N nodes with run-id prefix (no host port clash) · est 3
- AC: two `up` runs in parallel don't collide; network/containers carry run-id prefix.

**E1-4** · Call RPC into a node from a host Node.js script via `@ckb-ccc/fiber` · est 1
- AC: script calls node-info successfully against the running stack.

**E1-5** · Confirm pinned FNN version (from demo-0.8) recorded · est 1
- AC: version pinned in `package.json`/`scenario-catalog.md`; open question closed.

---

## EPIC E2 — Project skeleton

**E2-1** · Init repo: `package.json`, strict `tsconfig`, `tsx`, folders per layout · est 1
- AC: `npm install` works, folder structure matches system-design section 10.

**E2-2** · `fiber-lab.config.ts` (global config) + loader that reads config · est 1
- AC: importing config returns the correct default values.

**E2-3** · `lib/fiber/client.ts` — wrap `@ckb-ccc/fiber`, call RPC by node name · est 2
- AC: can call `get_node_info`/`list_channels` against a specific node.

**E2-4** · `lib/runlog/store.ts` — write/read run-log JSON per schema · est 2
- AC: create/read `.fiber-lab/runs/<run-id>.json` matching the data-dictionary schema.

---

## EPIC E3 — Scenario engine

**E3-1** · Define zod schema for scenario (Channel/SeedStep/Expectation) · est 2
- AC: schema matches `data-dictionary/scenario-schema.md`.

**E3-2** · `lib/scenario/loader.ts` — read YAML + zod validate, clear errors · est 2
- AC: invalid file → prints failing field, exit 1; valid file → returns typed object.

**E3-3** · `topology/compose.template.ts` — parametrize the demo-startup compose from scenario + run-id · est 3
- AC: given a scenario → emits a compose based on the demo-startup base with N nodes, network `flab_<run-id>`, prefixed containers (build on E1-3, don't regenerate from scratch).

**E3-4** · `lib/docker/orchestrator.ts` — `up`/`down` dynamic compose, isolated network · est 3
- AC: `up` builds the correct number of nodes; `down` removes network/containers cleanly.

**E3-5** · Wait for READY: poll `get_node_info` + `list_channels` after up · est 2
- AC: never seed before node/channel is READY; timeout per config.

**E3-6** · `lib/scenario/seeder.ts` — run SeedStep (open_channel, send_payment, new_invoice) · est 3
- AC: runs all `channels` + `seed`, records each RPC into run-log.

**E3-7** · Seeder: support `kill_node`/`start_node`/`wait` · est 2
- AC: `docker kill`/`start` the correct container by run-id; `wait` waits the right duration.

---

## EPIC E4 — CLI (fiber-lab)

**E4-1** · commander skeleton + `list` command · est 1
- AC: `fiber-lab list` lists scenarios + running runs.

**E4-2** · `up <scenario>` command (validate → up → seed → run-log → print run-id) · est 2
- AC: builds scenario end-to-end, prints run-id; `--json` returns JSON.

**E4-3** · `reset [run-id] / --all` command · est 2
- AC: cleans one run or all; no leftover containers/networks even if up failed midway.

**E4-4** · `logs <run-id> [--rpc] [--json]` command · est 1
- AC: prints summary; `--rpc` prints all raw RPCs; `--json` prints full run-log.

**E4-5** · `seed <scenario> [--run]` as a separate command · est 1
- AC: re-runs the seed part on a running run.

**E4-6** · Standard exit codes (0/1/2/3) + `--keep` on failure · est 1
- AC: exit codes per cli-spec; `--keep` keeps containers for debugging.

---

## EPIC E5 — Scenarios (must-have)

**E5-1** · Scenario `direct-channel` + verify deterministic over 3 runs · est 2
- AC: payment A→B succeeds, `expect` matches, 3 runs identical.

**E5-2** · Scenario `two-hop-route` (A-B-C) · est 3
- AC: A→C via B succeeds, `routeHops: 1` correct.

**E5-3** · Scenario `insufficient-capacity` · est 2
- AC: payment fails, `reason` matches the real `ErrorCategory` (verified in E0-5).

**E5-4** · Map raw RPC error → `ErrorCategory` (close open question) · est 2
- AC: update glossary + decisions-log with the verified error list.

---

## EPIC E6 — test-kit

**E6-1** · `setupScenario()` returns `ctx` (runId, RPC caller, reset) · est 2
- AC: usable in Vitest, auto up+seed, returns context.

**E6-2** · `expectPaymentSucceeds` / `expectPaymentFails` (poll + timeout) · est 2
- AC: asserts correctly; on timeout → fails with run-log attached.

**E6-3** · `expectChannelState` · est 1
- AC: asserts status/capacity of a channel.

**E6-4** · ≥1 example test in `test-kit/examples` passing · est 2
- AC: `npm test` passes from a clean state (with prerequisite doc).

---

## EPIC E7 — Docs & Submission

**E7-1** · `docs/scenario-catalog.md` (all scenarios + limits + pinned versions) · est 1
**E7-2** · README (problem → solution → how to run + prerequisites) · est 2
**E7-3** · LICENSE (MIT) · est 1
**E7-4** · Demo video 3–5 min (up → test pass/fail → logs → reset) · est 2
**E7-5** · Document trade-offs (devnet≠mainnet, fake peer-offline, version maintenance) · est 1

---

## EPIC E8 — Stretch (only if time allows)

**E8-1** · Scenario `expired-invoice` · est 2
**E8-2** · Scenario `peer-offline` (kill node mid-payment) · est 3
**E8-3** · Event-driven test-kit via `subscribe_store_changes` instead of polling · est 3
**E8-4** · Multi-asset scenario (RUSD/xUDT) · est 3

---

## Total estimate

- Must-have (E0–E7): ~65 points
- Day-5 scope-cut checkpoint: if E1 isn't done → drop E5-2/E8, keep `direct-channel` + `insufficient-capacity`.
