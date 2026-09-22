---
type: business_context
version: 1.0
last_updated: 2026-07-04
tags: [vision, scope, hackathon, testing, category-2]
---

# Project Vision — Fiber Test Lab

## The problem being solved

Payment channels (Fiber as much as Lightning) produce failure situations that **don't exist** in ordinary blockchain transactions:
- Directional capacity shortage (outbound/inbound)
- A multi-hop route can break partway through
- An intermediary peer/node going offline
- An invoice expiring

Right now, the ONLY way to "touch" these situations is to create them for real on the **public Pudge testnet**:
- **Slow** — waiting for real blocks (~a few seconds per block)
- **Shared** — network state keeps changing because other people are using it
- **Not reproducible** — running "the same test" twice gives two different results
- **Cannot be forced on demand** — you cannot deliberately trigger "a peer going offline at the exact moment of sending" without affecting other people

-> **Consequence:** nobody building an app on Fiber today can write automated (CI) tests for their payment-handling logic.

## The solution

**Fiber Test Lab** — a local test environment built with a single command:
- Each situation = one declarative YAML file (topology + seed + expect)
- The CLI reads the file -> builds N real Fiber nodes + a local CKB devnet -> seeds it automatically -> writes a run-log
- `test-kit` lets you write integration tests (`expectPaymentFails("insufficient_outbound")`) that run in CI
- Running it again and again always produces the same result (deterministic)

**Why this is "infrastructure" in the true sense:** Test Lab doesn't know and doesn't need to know what app is being tested — a wallet, a merchant gateway, a game, an agent can all use it. It directly answers the hackathon's core question: *"Does this help future developers interact with Fiber more easily?"*

**Relationship with `fiber-demo-startup` (the official repo):** demo-startup already provides the Docker infrastructure (a CKB dev chain + several FNN nodes) but in an **interactive-learning** form — opening channels/paying manually through a UI. It states 4 things it's missing to become a test harness itself: *automated channel-opening, scenario definitions, assertion logic, a CLI to run named scenarios*. **Test Lab builds ON TOP of demo-startup, adding exactly those 4 things** — turning a "learning environment" into "automated, reproducible testing". It doesn't reinvent the infrastructure; it only adds the missing automation layer. This both reduces schedule risk (no building Docker from scratch) and is a clear, distinct new contribution.

## Hackathon scope

**IN SCOPE — v1 (must-have):**
- The `fiber-lab` CLI with commands: `up`, `seed`, `reset`, `logs`, `list`
- Dynamic docker-compose generation from a scenario, isolated by run-id
- 3 core scenarios: `direct-channel`, `two-hop-route`, `insufficient-capacity`
- `test-kit` with basic assertions + at least one runnable example test
- A JSON run-log
- `docs/scenario-catalog.md` + README + a demo video

**IN SCOPE — v1 (if time allows):**
- 2 additional scenarios: `expired-invoice`, `peer-offline`
- A fully separated `seed`/`logs` command

**IN SCOPE — v2 (stretch, optional):**
- An event-driven test-kit via `subscribe_store_changes` instead of polling
- A multi-asset scenario (xUDT/RUSD)
- Trying FiberGate (Project 1) through Test Lab as proof of real-world value

**OUT OF SCOPE (documented as future work):**
- Running against a real testnet/mainnet (Test Lab is deliberately a local devnet)
- A GUI that **controls** a cluster (up/seed/reset from a browser) — the CLI stays the only control surface. Note: a **read-only** run viewer (`logs --html`, `fiber-lab ui`) moved INTO scope on 2026-09-22, post-hackathon; see decisions-log.
- A database server (uses JSON files)
- Precisely simulating real network failures (peer-offline via `docker kill` is best-effort)
- Internal routing algorithm/CCH work (not touched, only uses the RPCs that already exist)

## Trade-offs accepted (must be documented in the submission)

- **Devnet ≠ a real testnet/mainnet:** behavior (block time, fees, some limits) differs — local testing does NOT replace testing on a real testnet before release.
- **peer-offline simulated with `docker kill`:** not identical to a real network failure (natural timeouts, gradual packet loss).
- **Maintenance tied to the FNN version:** when FNN changes its RPC or image, scenarios must be updated — pinning the version reduces this risk.
- **Machine resources:** several nodes plus a devnet cost RAM/CPU — limited to 2-3 nodes per scenario.

## Target users

- Developers building apps on Fiber who want to write integration/CI tests for their payment logic
- Teams (including FiberGate) who want to test payment flows without depending on the public testnet
- People learning Fiber who want to experiment with routing/failure scenarios in a controlled environment

## Positioning (avoid overclaiming)

Test Lab helps you *test quickly and with control*, it does NOT fully replace testing on a real testnet. The accurate claim is: *"it lets a developer write automated tests for Fiber payment/routing — something that currently cannot be done"*, not *"it simulates the real network with 100% accuracy"*.
