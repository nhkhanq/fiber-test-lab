---
type: decisions_log
version: 1.0
last_updated: 2026-07-04
tags: [decisions, architecture, scope]
---

# Decisions Log — Fiber Test Lab

> Records decisions that have been **confirmed by a human**.
> Claude Code updates this file **after** the human confirms it in conversation.
> Do NOT add an entry without a clear confirmation.
>
> Format: `[YYYY-MM-DD] **Topic**: decision — Reason: why`

---

## Architecture & Tech Stack

[2026-07-04] **Chose Category 2**: Submit Test Lab under Category 2 (Node/Routing/Diagnostics); doing so alongside Test Lab creates 2 products for 2 different audiences (merchant vs. developer/operator), giving a more varied portfolio.

[2026-07-04] **CLI-first**: The product surface is the CLI + YAML files + test-kit, with NO web dashboard — Reason: the audience is developers (comfortable with a terminal/config); it saves hackathon time.

[2026-07-04] **No database, use JSON files**: The run-log is stored as a JSON file, not Postgres — Reason: Test Lab's data lives for minutes to hours and every reset wipes it clean; adding a DB would be over-engineering and works against the goal of "local, lightweight, one command". If complex querying is needed later -> consider SQLite (still no DB server needed).

[2026-07-04] **A local devnet, not a testnet**: Run on a local CKB dev chain — Reason: the goal is a reproducible, controllable environment; the public testnet is slow/shared/cannot be forced into failure on demand. The trade-off (devnet ≠ mainnet) is accepted and documented.
  > **Updated after reading the real docs (see "Verified from official docs" below):** the CKB dev chain comes from `fiber-demo-startup`'s docker-compose (already dockerized), NOT standalone `offckb` as originally assumed. `offckb` can still be used as a fallback if needed, but the proven path is demo-startup's compose.

[2026-07-04] **Real nodes, no protocol mocking**: Use the real FNN binary inside containers, do not simulate the protocol — Reason: test results must reflect real Fiber behavior; mocking the protocol would make the tests meaningless.

[2026-07-04] **Sharing use of `@ckb-ccc/fiber`**: Not considered a duplication — Reason: this is the official SDK the hackathon recommends; choosing the same standard library is different from sharing code/UI. The repos remain fully independent.

[2026-07-04] **Dynamic compose, not a fixed hand-written file**: `topology/compose.template.ts` generates docker-compose from the scenario + run-id — Reason: node count/names/ports change per scenario and must be isolated by run-id, so a single hardcoded compose file is not possible.

[2026-07-04] **Isolation by run-id**: Every `up` generates a run-id, and every resource is prefixed by it — Reason: this allows parallel runs (multiple terminals/CI jobs) without collisions; it plays a role similar to FiberGate's "registration mechanism" but for "one run" instead.

---

## Scope

Test Lab's underlying technical footprint is simpler (devops/scripting, no need for deep routing/CCH work).

[2026-07-04] **3 must-have scenarios + 2 if time allows**: Must-have: `direct-channel`, `two-hop-route`, `insufficient-capacity`; if time allows, add `expired-invoice`, `peer-offline` — Reason: the first three are enough to prove the core value (routing + the most common failures); a checkpoint at the end of Day 5 decides whether to cut scope.

[2026-07-04] **Step 0 (hands-on practice) is mandatory before writing code**: Install fnn, manually open_channel/send_payment/list_channels/close_channel on the testnet once — Reason: without understanding the 4 core commands by hand, you cannot tell whether the CLI is automating them correctly.

---

## Verified from official docs (2026-07-04)

> Cross-checked against the hackathon onboarding docs (github.com/RetricSu/fiber-hackathon-docs) + fiber.world/docs. These are TRUTHS confirmed from the docs, replacing earlier assumptions.

[2026-07-04] **Build ON TOP of `fiber-demo-startup`, NOT Docker from scratch**: The official repo `HappySonnyDev/fiber-demo-startup` (branch `demo-0.8`) already provides a docker-compose with a local CKB dev chain + several Fiber nodes (1 bootnode + 3 nodes + a funding transfer container) — Reason: this is the riskiest, most time-consuming infrastructure layer, and it is already proven to work; forking/building on it greatly reduces schedule risk. Test Lab focuses on the layer that does NOT yet exist: automated channel-opening (the seeder), scenario YAML, assertions (test-kit), a CLI to run a named scenario — exactly what demo-startup itself states is "missing" (it is "interactive learning", not "automated testing").

[2026-07-04] **Positioning relative to fiber-demo-startup**: demo-startup = an interactive learning environment (opening channels/paying manually through a UI); Test Lab = turns it into reproducible automated testing (scenarios + assertions + a CLI) — Reason: a clearly different purpose, not a copy; a stronger submission story: "not reinventing the infrastructure, making it testable".

[2026-07-05] **Pin FNN 0.8.0 (the official binary + a hand-written Dockerfile)**: Use FNN version 0.8.0 (stable), downloading the official binary from the GitHub release (`fnn_v0.8.0-x86_64-linux.tar.gz`) into a thin, hand-written Dockerfile — NOT using the official image (only available from 0.9.0-rc, not yet stable) and NOT compiling from source. — Reason: 0.8.0 was fully verified in E0 (RPC/params/errors/balances), which preserves determinism; 0.9.0 only has a release candidate so far; the official binary is readily available, so no need for a long build like demo-startup's.

[2026-07-05] **CKB devnet: a custom genesis with fiber-scripts baked in**: Build the CKB devnet with a genesis that has the Fiber on-chain scripts baked in (FundingLock/CommitmentLock/simple_udt) plus pre-funded accounts, using a hand-written config (informed by demo-startup, not copied). — Reason: FNN cannot run on an empty devnet; a custom genesis gives the fastest startup on `up`, avoiding a runtime script-deployment step; the trade-off is a more complex genesis config.

[2026-07-05] **Reimplement compose separately, do NOT fork demo-startup's files**: fiber-demo-startup has no LICENSE file (checked in E1-1: the GitHub API returns license=null; nervosnetwork/fiber also has no clear license) -> "no license" means all-rights-reserved, so forking/redistributing is not permitted in principle. Decision: Test Lab **writes its own** docker-compose + Dockerfile (learning from how demo-startup does it, but new code), without copying their files. — Reason: legal safety; still retains the topology/fund-flow knowledge learned by hand in E0. Consequence: E1-3/E3-3 shift from "parameterizing demo-startup's compose" to "generating Test Lab's own dynamic compose" (the run-id isolation principle is unchanged; offckb remains a documented fallback option for the CKB devnet as the spec already notes).

[2026-07-04] **`fnn-cli` uses a subcommand structure**: In reality it is `fnn-cli info`, `fnn-cli peer list_peers`, `fnn-cli channel list_channels` — NOT flat commands like `fnn-cli open_channel` as previously assumed. An FNN release includes 2 binaries: `fnn` (HTTP RPC + node) and `fnn-cli` (the management CLI).

[2026-07-04] **Official RPC source**: fiber.world/docs/api-reference (the RPC reference) + the quick-starts: run-a-node, basic-transfer, transfer-stablecoin, multi-hop-transfer (exactly the two-hop-route scenario). FNN source: github.com/nervosnetwork/fiber. — Used as the source for E0-4 (the RPC notebook) instead of guessing.

---

## Open Questions

> Unresolved issues. Remove a line once it has a decision and move it above.

- [~] The exact `ErrorCategory` list — partially verified (E0-5, 2026-07-05): `insufficient_outbound` = raw error code -32000, message "Failed to build route, Insufficient balance: max outbound liquidity ... insufficient". The rest (no_route_found, invoice_expired, peer_offline...) not yet forced. Detail: docs/hands-on/rpc-notebook.md section 8.
- [x] ~~Can FNN run inside a Docker container~~ — RESOLVED: `fiber-demo-startup` has already dockerized FNN successfully (multi-node + a CKB dev chain). All that remains is cloning + verifying it runs on our own machine (E1).
- [x] ~~Do we need to build our own FNN image~~ — RESOLVED: use demo-startup's existing Dockerfile/compose as the starting point.
- [x] ~~The exact RPC method names~~ — RESOLVED (E0, 2026-07-05): the method is `node_info` (NOT get_node_info), `shutdown_channel` (NOT close_channel). `open_channel` params use `pubkey` + `funding_amount` (hex shannon). Numeric responses are hex; `result:null` = OK. Full signatures: docs/hands-on/rpc-notebook.md.
- [x] ~~Does `fiber-demo-startup`'s license allow forking/building on top~~ — RESOLVED (2026-07-05): it has NO license -> decided to reimplement our own compose instead of forking (see the 2026-07-05 decision above).
