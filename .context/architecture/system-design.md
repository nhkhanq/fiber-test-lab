---
type: architecture
version: 1.0
last_updated: 2026-07-04
tags: [typescript, docker-compose, fiber-node, ckb-devnet, cli, testing, local]
---

# System Design — Fiber Test Lab

> This is the most detailed architecture definition file. Every implementation decision must match this file.

## 1. Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-------|
| Language | TypeScript (strict) | Consistent with the Fiber JS/TS ecosystem, easy to maintain |
| Running the CLI | `tsx` | Runs `.ts` directly, no separate build step — optimizes for hackathon speed |
| CLI framework | `commander` | Lightweight, enough for ~5 commands, no need for a heavy framework |
| Scenario parsing | `yaml` | Reads `.yaml` scenario files |
| Schema validation | `zod` | Validates a scenario BEFORE building Docker resources — fail fast, clear message |
| Underlying docker infrastructure | **fork of `fiber-demo-startup`** (`demo-0.8`) | Already dockerizes the CKB dev chain + several FNN nodes + a transfer container — no need to build from scratch (see section 2b) |
| Container orchestration | Docker + Docker Compose (v2, `docker compose`) | Orchestrates N Fiber nodes + the CKB dev chain, isolated on an internal network |
| Fiber node | The official FNN binary (pinned version) — image from demo-startup | A REAL node, not a protocol simulation — test results reflect real behavior |
| CKB devnet | A self-built CKB dev chain (`nervos/ckb:v0.207.0` image + a baked `dev.toml` genesis) | A local devnet, funded via **genesis pre-funding** (3 fixed keys, 10 billion CKB per node) — NOT using offckb/a transfer container. Compatible with the offckb 0.4.7 convention. |
| Calling Fiber RPC | `@ckb-ccc/fiber` (the official SDK) | The SDK recommended by the hackathon, avoids hand-writing raw JSON-RPC |
| Test framework | Vitest | Lightweight, fast, used for `test-kit` and example tests |
| Storing the run-log | A JSON file (fs) | Short data lifecycle — no need for Postgres (see section 8) |
| Package manager | npm | A single package, no workspace needed |

**Pinned versions:** the FNN version (per `fiber-demo-startup demo-0.8`) and the `@ckb-ccc/fiber` version must be pinned in `docs/scenario-catalog.md` and `package.json` — RPC behavior can change between versions, so verified results are only valid for the tested version.

## 2b. Build ON TOP of fiber-demo-startup (not from a blank Docker setup)

> Verified from the official docs (2026-07-04): the repo `github.com/HappySonnyDev/fiber-demo-startup` (branch `demo-0.8`) already provides a docker-compose that runs a **local CKB dev chain + 1 bootnode + 3 Fiber nodes + a transfer container (funding) + a demo app**. This is the riskiest, most time-consuming infrastructure layer — and it ALREADY EXISTS.

**Clear split: what is reused, what Test Lab builds itself**

| Layer | Source | Note |
|---|---|---|
| CKB dev chain + FNN node containers + fund distribution | **fiber-demo-startup (reused)** | Fork its compose + Dockerfile as the base |
| Automated channel opening (seeder) | **Test Lab (new)** | demo-startup opens channels manually through its UI — Test Lab automates this |
| Scenario YAML (topology + seed + expect) | **Test Lab (new)** | demo-startup has no concept of a scenario |
| Assertion / validation (test-kit) | **Test Lab (new)** | demo-startup has none |
| CLI to run a named scenario + run-id isolation + run-log | **Test Lab (new)** | demo-startup only has an interactive demo app |

`fiber-demo-startup` itself states the 4 things it is MISSING to become a test harness — which exactly match the "new" items above. That is Test Lab's boundary of contribution.

**Consequence for "dynamic compose" (section 6):** instead of generating compose entirely from scratch, Test Lab **parameterizes demo-startup's compose** (node count, capacity, run-id prefix) — lighter and lower risk. The run-id isolation principle still holds.

## 2. Overall architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     The developer's local machine                    │
│                                                                       │
│   developer ──> fiber-lab CLI (commander, run via tsx)               │
│                     │                                                 │
│                     │ 1. reads scenarios/<name>.yaml                 │
│                     │ 2. validates with zod                          │
│                     │ 3. generates a run-id + dynamic docker-compose │
│                     │ 4. docker compose up (network isolated per run-id)│
│                     │ 5. seed: calls RPC to open channels/create invoices│
│                     │ 6. writes the run-log JSON                     │
│                     ▼                                                 │
│   ┌───────────────────────────────────────────────────────────────┐ │
│   │   Isolated Docker network: flab_<run-id>  (NOT bound to host)  │ │
│   │                                                                 │ │
│   │   ┌──────────┐    ┌──────────┐    ┌──────────┐                 │ │
│   │   │ fnn:alice│◄──►│ fnn:bob  │◄──►│ fnn:carol│  (internal P2P) │ │
│   │   └────┬─────┘    └────┬─────┘    └────┬─────┘                 │ │
│   │        │               │               │                       │ │
│   │        └───────────────┴───────────────┘                       │ │
│   │                        │ (each fnn connects to the CKB devnet) │ │
│   │              ┌──────────▼─────────────┐                         │ │
│   │              │ CKB devnet container   │  (nervos/ckb v0.207.0,  │ │
│   │              │ self-baked genesis)    │   not offckb)           │ │
│   │              └────────────────────────┘                         │ │
│   └───────────────────────────────────────────────────────────────┘ │
│                     ▲                                                 │
│                     │ RPC (only the CLI + test-kit call in, through  │
│                     │ a temporary port map per run-id, or exec inside)│
│   test-kit (Vitest) ┘  expectPaymentSucceeds() / expectPaymentFails()│
└─────────────────────────────────────────────────────────────────────┘
```

## 3. Components and their roles

### 3.1 `cli/` — fiber-lab (the ONLY entry point into the node cluster)
Nobody calls JSON-RPC directly into a container. Every operation goes through the CLI so state is logged and reset correctly. Handlers are thin — they only parse arguments and call into `lib/`.

Commands (full spec in `api/cli-spec.md`):
- `fiber-lab up <scenario>` — build the topology
- `fiber-lab seed <scenario>` — run the scenario's `seed` section
- `fiber-lab reset [run-id]` — teardown + remove state
- `fiber-lab logs <run-id>` — print the run-log
- `fiber-lab list` — list available scenarios + running runs

### 3.2 `topology/` — scenarios + dynamic compose
- `scenarios/*.yaml` — each file is one scenario (tier-1 settings, something a developer can write by hand). Schema in `data-dictionary/scenario-schema.md`.
- The compose file is **generated dynamically** from the scenario, not hand-written and fixed — because the node count/names/ports change per scenario and per run-id.

### 3.3 `lib/` — core logic
- `lib/fiber/client.ts` — wraps `@ckb-ccc/fiber`, calls RPC on a specific node by name
- `lib/docker/orchestrator.ts` — generates compose, `up`/`down`, isolates the network by run-id
- `lib/scenario/loader.ts` — reads + validates YAML (zod)
- `lib/scenario/seeder.ts` — executes the `seed` section (open channels, create invoices, kill containers...)
- `lib/runlog/store.ts` — write/read the run-log JSON

### 3.4 `test-kit/` — assertion helpers (used from Vitest)
- `expectPaymentSucceeds(ctx, paymentId)`
- `expectPaymentFails(ctx, paymentId, reason)`
- `expectChannelState(ctx, channelId, { status, capacity })`
- Internally these **poll** RPC on an interval + timeout (because FNN does not push events — see section 7).

### 3.5 `fiber-lab.config.ts` — global config (tier-2 settings)
Applies to EVERY scenario, set once by the developer:
```typescript
export default {
  pollIntervalMs: 1000,
  pollTimeoutMs: 30000,
  dockerNetworkPrefix: "flab",
  fnnImage: "fnn:v0.x.y",      // pinned
  logLevel: "info",
  keepRunOnFailure: false,      // keep the container when a test fails, for debugging
}
```

## 4. Two-tier config (the "settings" a developer can tune)

| Tier | Where | Adjusts what | Who changes it |
|---|---|---|---|
| **Tier 1 — per-scenario** | `scenarios/<name>.yaml` | One specific situation: which nodes, which channels, capacity, amount, what to expect | The developer creates/edits YAML files, without touching code |
| **Tier 2 — global** | `fiber-lab.config.ts` | System-wide behavior: timeout, poll interval, prefix, image version | The developer edits it once, it applies everywhere |

A developer who wants to add a new kind of failure creates a new `.yaml` file following the schema, without touching the CLI. `zod` guarantees an immediate, clear error if the file doesn't match the shape.

## 5. Data flow — `fiber-lab up two-hop-route`

```
1. The CLI reads scenarios/two-hop-route.yaml
2. loader.ts validates with zod -> on a bad schema: print a clear error, exit 1 (Docker untouched)
3. generate a run-id (e.g. timestamp + a short random suffix) -> network name = flab_<run-id>
4. orchestrator.ts generates dynamic compose: N fnn services (alice/bob/carol) + 1 CKB devnet,
   all on network flab_<run-id>, container names prefixed by the run-id
5. docker compose up -d -> wait for each node's healthcheck to pass (poll node_info)
6. fund CKB via genesis pre-funding (3 fixed keys baked into dev.toml) -- no runtime faucet needed
7. seeder.ts reads the `channels` section -> calls open_channel alice->bob, bob->carol,
   waits for the channel to be READY (poll list_channels)
8. seeder.ts reads the `seed` section -> executes it (e.g. send_payment alice->carol amount 100)
9. store.ts writes the run-log JSON: {runId, scenario, steps[], rpcResponses[], startedAt}
10. print the run-id to stdout for the developer/test-kit to use next
```

## 6. Isolation by run-id (avoiding collisions)

Problem: two parallel `up` runs (two terminals, or CI running multiple jobs) -> colliding container/port names -> breakage.

Solution: every `up` generates one unique **run-id**. Every resource is prefixed by the run-id:
- Docker network: `flab_<run-id>`
- Containers: `flab_<run-id>_alice`, `..._bob`, ...
- Run-log file: `./.fiber-lab/runs/<run-id>.json`
- Port map (when temporarily exposed for the test-kit): allocated dynamically, never hardcoded

`fiber-lab reset` with no argument -> cleans up EVERY run. `reset <run-id>` -> cleans up only one run. (A role similar to FiberGate's "app registration mechanism", but for "one test run" instead of "one app".)

## 7. FNN does not push status updates -> polling (and an upgrade path)

FNN does not push an event when a channel's or payment's status changes -- you must actively ask (`list_channels`, `get_invoice`). Because of this, `test-kit` **polls** by default, on `pollIntervalMs` + `pollTimeoutMs` (from the global config).

**Upgrade path (optional, step 6):** FNN has a `subscribe_store_changes` RPC (the `pubsub` module, confirmed to really exist as of FNN v0.8.1 in Project 1's research -- see `project1/.context/architecture/system-design.md` "Phase 2"). That result could be reused to build an event-driven test-kit (waiting for the actual event instead of blind polling), which would be faster and less flaky. NOT required for v1.

## 8. Why NOT use a database

- Test Lab: data lives for minutes to hours, and every `reset` wipes it clean. **A JSON file is enough.**
- If complex queries over the run-log become necessary later -> consider SQLite (still no DB server needed).

## 9. Security / network isolation

- Every `fnn` container + the CKB devnet only listens on the internal Docker network `flab_<run-id>`, and is NOT bound to the host/internet by default.
- Reason: test nodes use fake devnet keys/funds -- if a port were exposed, an unrelated node could connect in and break the declared topology, corrupting test results.
- A temporary port map per run-id is only opened when the test-kit needs to call RPC from the Vitest process (outside Docker), and is closed again on reset.

## 10. Repo layout

```
fiber-test-lab/                          
├── cli/
│   ├── index.ts                         — entry point (commander)
│   └── commands/                        — up.ts, seed.ts, reset.ts, logs.ts, list.ts
├── lib/
│   ├── fiber/client.ts
│   ├── docker/orchestrator.ts
│   ├── scenario/loader.ts
│   ├── scenario/seeder.ts
│   └── runlog/store.ts
├── topology/
│   ├── compose.template.ts             — generates compose dynamically
│   └── scenarios/
│       ├── direct-channel.yaml
│       ├── two-hop-route.yaml
│       ├── insufficient-capacity.yaml
│       ├── expired-invoice.yaml
│       └── peer-offline.yaml
├── test-kit/
│   ├── index.ts                        — assertion helpers
│   └── examples/                       — example tests (*.test.ts) showing real usage
├── .fiber-lab/runs/                    — run-log JSON (gitignored)
├── fiber-lab.config.ts                 — global config
├── docs/
│   ├── scenario-catalog.md
│   └── README.md
├── package.json
└── tsconfig.json
```

## 11. Boundary with FiberGate (Project 1) — no overlap

| | FiberGate (P1) | Fiber Test Lab (P3) |
|---|---|---|
| Category | 3 — Merchant/Liquidity | 2 — Node/Routing/Diagnostics |
| Problem | A merchant RECEIVING payments reliably | A developer TESTING payment/routing reproducibly |
| Surface | Web dashboard + REST API + webhook | CLI + YAML files + test-kit |
| Data | PostgreSQL (long-lived) | JSON files (temporary, resettable) |
| Node count | 1 node facing the outside world | Multiple nodes talking to each other, a closed network |
| Environment | testnet | a local CKB devnet (self-baked, offckb-like) |
| Dependency | Does not import P3 | Does not import P1 |

Rule: separate repos, no importing `@fibergate/sdk`, no need for FiberGate to be running. The ONLY shared point allowed: both use the official `@ckb-ccc/fiber` SDK (not shared code, just the same choice of a standard library).
