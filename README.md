# Fiber Test Lab

A fully-local, one-command test environment for [Fiber Network](https://github.com/nervosnetwork/fiber) — the payment-channel layer on CKB.

## The problem

Payment/routing failure modes (insufficient capacity, no route, expired invoice, peer offline) are exactly what you need to test against — and exactly what you **can't force reliably** on a public testnet. Reproducing them means hand-wiring nodes, funding channels, and hoping the timing lines up.

## The solution

`fiber-lab up <scenario>` spins up real FNN nodes + a CKB devnet in Docker, opens the channels, runs the seed steps, and records every RPC to a run-log — deterministically, isolated per run-id, cleanable with one command. Scenarios are plain YAML; assertions are a small Vitest `test-kit`. It's **developer tooling**, not a node or wallet.

Built for the "Gone in 60ms" Fiber Network hackathon (Category 2 — Node/Routing/Diagnostics).

## Prerequisites

- **Docker** (compose v2) running. The first `up` builds the FNN + CKB images (a few minutes; cached after).
- **Node.js ≥ 20**. Runs directly via `tsx` — no build step.

```bash
npm install
```

## Quick start

```bash
npm run lab -- up direct-channel        # build topology + seed, prints a run-id
npm run lab -- list                     # available scenarios + current runs
npm run lab -- logs <run-id> --rpc      # full run-log (every RPC)
npm run lab -- reset <run-id>           # teardown one run (or: reset --all)
```

Every command takes `--json` for CI. Exit codes: `0` ok · `1` config/validation · `2` runtime (docker/RPC) · `3` expectation mismatch.

| Command | What it does |
|---|---|
| `up <scenario> [--json] [--keep]` | validate → up → seed → verify expectation → print run-id |
| `seed <scenario> [--run <id>]` | re-run just the seed steps on a running run |
| `reset [run-id] [--all]` | teardown + clean (no leftover containers/networks) |
| `logs <run-id> [--rpc] [--json]` | run-log summary / raw RPCs / full JSON |
| `list [--json]` | scenarios + runs |

## Scenarios

Bundled scenarios (see [`docs/scenario-catalog.md`](docs/scenario-catalog.md) for verified results):

- **`direct-channel`** — alice pays bob over one channel (fee 0, deterministic over 3 runs).
- **`two-hop-route`** — alice pays charlie routed through bob (`routeHops: 1`, non-zero routing fee).
- **`insufficient-capacity`** — payment exceeds outbound → fails with `reason: insufficient_outbound`.

A scenario is a YAML file in `topology/scenarios/`:

```yaml
name: direct-channel
nodes: [alice, bob]
channels:
  - { from: alice, to: bob, capacity: 500 }
seed:
  - { action: send_payment, from: alice, to: bob, amount: 100 }
expect:
  status: succeeded
```

## test-kit (Vitest)

Import `lib/` directly — no shelling out. Each helper polls RPC with a timeout (FNN pushes no events).

```typescript
import { setupScenario, expectPaymentFails } from "fiber-test-lab/test-kit";

const ctx = await setupScenario("insufficient-capacity");   // up + seed
await expectPaymentFails(ctx, ctx.lastPaymentId, "insufficient_outbound");
await ctx.reset();
```

Helpers: `expectPaymentSucceeds`, `expectPaymentFails(reason?)`, `expectChannelState(id, { status, capacity })`. See [`test-kit/examples/`](test-kit/examples).

```bash
npm test                            # all scenarios + examples (sequential, from a clean state)
npx vitest run test-kit/examples    # just the examples
```

## Determinism & versions

Same scenario + same pinned versions ⇒ same result. Results are only valid for the pinned FNN `0.8.0` and `@ckb-ccc` versions in [`package.json`](package.json) / [`docs/scenario-catalog.md`](docs/scenario-catalog.md). See [`docs/trade-offs.md`](docs/trade-offs.md) for devnet-vs-mainnet caveats.

## License

[MIT](LICENSE).
