# Fiber Test Lab

Forcing a real Fiber Network failure on demand is one of the hardest things to do reliably:
you cannot make a peer go offline mid-payment, drain a channel to an exact balance, or expire
an invoice, on a shared public testnet, and have it happen the same way twice. Fiber Test Lab
solves this by reproducing every one of those failure modes deterministically, using real
Fiber Network Node (FNN) processes and a real CKB devnet running entirely on your own machine.

To prove this is not a mock, the package is published on npm and consumed the same way any
real dependency would be: installed into a separate project, imported, and used to drive
assertions against real Docker containers. No RPC response is faked and no failure is
hand-written; every scenario is a live payment or routing attempt against a real Fiber node,
classified from the node's own raw error.

Try it or read the source:

- npm package: [npmjs.com/package/fiber-test-lab](https://www.npmjs.com/package/fiber-test-lab) (`npm install fiber-test-lab`)
- GitHub repository: [github.com/nhkhanq/fiber-test-lab](https://github.com/nhkhanq/fiber-test-lab)

Built for the "Gone in 60ms" Fiber Network hackathon, Category 2 (Node, Routing, and
Diagnostics Infrastructure).

## What Fiber Test Lab does

1. Declare a scenario: a YAML file listing the nodes, the channels between them, a sequence of
   seed actions (a payment, an invoice, a killed node), and the expected outcome.
2. Run it: `fiber-lab up <scenario>` generates a Docker Compose topology for that scenario,
   starts real FNN nodes and a CKB devnet in an isolated network, and waits for every node to
   report healthy.
3. Force the real failure: the seeder executes the scenario's actions against the live nodes,
   over the same JSON-RPC interface a production integration would use, so the failure is
   whatever the protocol actually returns, not a simulation of it.
4. Classify the result: FNN returns the same generic JSON-RPC error code for every failure, so
   Fiber Test Lab classifies the raw message (and, where the message is ambiguous, an
   out-of-band signal such as peer connectivity) into a stable `ErrorCategory`, then compares
   it against the scenario's `expect` block.
5. Consume it from anywhere: any Node.js project can `npm install fiber-test-lab` and drive
   the same scenarios through `fiber-test-lab/test-kit`, feeding the real classified result
   directly into its own business logic under test.

This document is the full reference for that package: installation, the CLI, the scenario
file format, and the complete test-kit API with every parameter and the failure cases each one
is meant to cover. The architecture and design rationale follow below the table of contents.

## Table of contents

- Architecture
- The test-kit flow
- Design notes
- Requirements
- Installation
- Pinned versions
- Quick start with the CLI
- CLI command reference
- Run viewer
- Scenario file reference
- Built-in scenarios
- Writing a custom scenario
- test-kit API reference
  - setupScenario
  - ScenarioContext
  - expectPaymentSucceeds
  - expectPaymentFails
  - expectChannelState
  - subscribePayments and ctx.watchPayments
- Error category reference
- Run-log reference
- Determinism and version pinning
- License

## Architecture

Everything is generated per run and isolated by a run-id, so nothing is shared between
scenarios and nothing has to be cleaned up by hand.

```
[Scenario YAML] --> [fiber-lab CLI / test-kit] --> [Generated docker-compose.yml]
                             |                                |
                             | 1. validate with zod           v
                             | 2. generate a run-id     [Isolated network: flab_<run-id>]
                             | 3. wait for READY               |
                             |                     +------------+------------+
                             |                     |            |            |
                             |               [FNN alice]  [FNN bob]  [FNN charlie]
                             |                     |            |            |
                             |                     +------------+------------+
                             |                                  |
                             v                          [CKB devnet container]
                    [Run-log JSON file]
                 (.fiber-lab/runs/<runId>.json)
```

No container binds a port to the host by default; RPC access from the CLI or the test-kit
goes through an ephemeral port map that is opened for the duration of the run and closed on
`reset`. Every RPC call made against every node, successful or not, is appended to the
run-log, which is the only record left once the containers are gone.

## The test-kit flow

This is the flow that matters most for adoption: a project that has nothing to do with this
repository installs `fiber-test-lab`, and uses it to test its own code against a real Fiber
failure.

```
[Consumer project]      [test-kit]              [Docker: FNN + CKB devnet]     [Consumer's own logic]
       |                     |                              |                          |
       |-- setupScenario --->|                               |                          |
       |                     |-- up: build topology,         |                          |
       |                     |   open channels, run seed --->|                          |
       |                     |<---- real RPC responses -------|                          |
       |                     |-- classify raw FNN error                                  |
       |                     |   into an ErrorCategory                                   |
       |<-- ctx.expectation.reason.actual (e.g. "peer_offline") -----------------------> |
       |                                                                        decideRetry(reason), etc.
       |-- assert against the real result ------------------------------------------------|
       |-- ctx.reset() ----->|                               |                          |
       |                     |-- docker compose down -------->|                          |
```

A working example of this is a small companion project built to validate the package after
publishing: a Fiber payment retry policy (`decideRetry(attempt, reason)`, deciding whether a
failed payment should be retried, and how) tested against `fiber-test-lab` installed from the
public registry. Running its test suite caught a real off-by-one bug in the policy's default
branch before the policy code shipped anywhere else, because the failure it was tested against
was a real one, not an assumption about what Fiber's error might look like.

## Design notes

**Why a self-built CKB devnet instead of a shared testnet.** Determinism requires control over
every account, every balance, and every block. A shared devnet or public testnet cannot
guarantee that a channel has exactly the outbound balance a scenario needs, or that a peer
can be forced offline at the exact moment a payment is in flight. Each `up` bakes its own CKB
genesis, funds accounts directly from it, and runs on an isolated Docker network named after
its run-id, so two runs of the same scenario never interfere with each other and always start
from the same state.

**Why a payment's fee is the only reliable signal of a routed hop.** FNN's `get_payment` does
not return the route a payment took. The only observable difference between a direct payment
and one routed through an intermediary is the fee: `0x0` for a direct channel, and a non-zero
value for a payment that passed through an intermediary and paid its routing fee. The
`two-hop-route` scenario's `routeHops` expectation is verified against this fee, not against
any field FNN exposes directly.

**Why `peer_offline` cannot be classified from the error message alone.** FNN always returns
JSON-RPC error code -32000 regardless of cause, and an offline peer produces the exact same
"max outbound liquidity 0" message as a channel that is simply out of capacity
(`insufficient_outbound`). The two are only distinguishable by checking whether the target is
still present in the sender's `list_peers` output at the moment the payment fails, which is
why that check runs before the raw message is even inspected. See the Error category
reference below for the full classification table.

## Requirements

- Docker with Compose v2 available as `docker compose`.
- Node.js 20 or later.
- Enough local resources to run up to three containers (one CKB devnet plus up to two or
  three FNN nodes) per active scenario. Scenarios do not share containers with each other.

No separate build step is required. The package ships TypeScript source and runs directly
through `tsx`, which is installed as a regular dependency.

## Installation

Install the package into any Node.js project:

```bash
npm install fiber-test-lab
```

This adds two things to the project:

- A `fiber-lab` binary in `node_modules/.bin`, runnable through `npx fiber-lab <command>`.
- A library export at `fiber-test-lab/test-kit` for use from application or test code.

Docker is required on the machine actually running the scenarios (the developer's machine or
a CI runner), not on the machine that only imports `fiber-test-lab/test-kit` as a type or
build dependency.

## Pinned versions

Every scenario result in this document, and every result the test-kit verifies, is only valid
for the following pinned versions. If a project depends on a different FNN or `@ckb-ccc`
version, results should be re-verified before being trusted.

| Component | Version |
|---|---|
| Fiber Network Node (FNN) | 0.8.0 (commit 335a74a) |
| `@ckb-ccc/core` and `@ckb-ccc/fiber` | 0.0.0-canary-20260330023358 |
| CKB devnet image | nervos/ckb v0.207.0 |
| Node.js | 20 or later |

## Quick start with the CLI

```bash
npx fiber-lab list
npx fiber-lab up direct-channel
npx fiber-lab logs <run-id> --rpc
npx fiber-lab reset <run-id>
```

`up` prints a run-id on success. Every command accepts `--json` for machine-readable output,
which is the recommended mode for CI.

Exit codes are standardized across every command:

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Configuration or scenario validation error (nothing was built) |
| 2 | Runtime error (Docker or RPC failure) |
| 3 | The scenario ran, but its result did not match the `expect` block |

## CLI command reference

### up

```bash
fiber-lab up <scenario> [--json] [--keep]
```

Validates the scenario, generates a unique run-id, builds an isolated Docker network and the
required containers, waits for every node to report ready, opens the declared channels, runs
the seed steps, verifies the `expect` block, and prints the run-id.

- `<scenario>` is a built-in scenario name (see Built-in scenarios) or a path to a `.yaml`
  file, resolved relative to the current working directory.
- `--json` prints `{ "runId": string, "network": string, "nodes": NodeRecord[] }` instead of
  just the run-id.
- `--keep` leaves the containers running if the run fails, instead of tearing them down, so
  the state can be inspected with `docker logs` or `fiber-lab logs`.

Exit code 3 means the run completed but its outcome did not match `expect`; the run is left
running in that case so it can be inspected, even without `--keep`.

### seed

```bash
fiber-lab seed <scenario> [--run <run-id>] [--json]
```

Re-runs only the `seed` steps of a scenario against an already running run, without reopening
channels. Useful for sending another payment, or repeating a failure, against a topology that
is already up.

- Without `--run`, it targets the most recent non-reset run of that scenario.
- `--json` prints the array of steps that were just executed.

### reset

```bash
fiber-lab reset [run-id] [--all] [--json]
```

Tears down Docker resources for one run, or for every run when `--all` is passed or no
run-id is given. Removes containers and the isolated network; the run-log JSON file is kept
so it remains available for later inspection.

- `--json` prints `{ "cleaned": string[] }`, the list of run-ids that were torn down.

### logs

```bash
fiber-lab logs <run-id> [--rpc] [--json] [--html [path]]
```

Prints the run-log for a given run-id.

- With no flags, prints a summary: status, network name, timestamps, nodes, and each
  high-level step (`open_channel`, `send_payment`, and so on).
- `--rpc` prints every raw RPC call made during the run: node, method, parameters, and
  response or error.
- `--json` prints the entire run-log file as JSON.
- `--html [path]` writes an HTML report instead of printing (default:
  `.fiber-lab/runs/<run-id>.html`). See [Run viewer](#run-viewer) below.

This works after the run has been reset, because the run-log file is not deleted by `reset`.

### ui

```bash
fiber-lab ui [--port <n>] [--open] [--json]
```

Serves the run viewer on `127.0.0.1` — never on `0.0.0.0`, because a run-log carries node
pubkeys, container names and every raw RPC of the run. With no `--port` it takes a free
ephemeral port and prints the URL. Exits `2` if the port you asked for is taken.

The page lists every run in `.fiber-lab/runs/` and links to each report. A report opened this
way polls its own run-log every two seconds and reloads when it grows, so you can start
`fiber-lab up` in one terminal and watch the topology and RPC calls fill in.

## Run viewer

The same report renders two ways: `logs --html` writes it to a file, `ui` serves it live. Both
show

- a **topology graph** — one SVG edge per channel, where the thick segment is the left node's
  local balance and the dot marks the split, so you can see which way the liquidity sits; the
  edge along the payment path is highlighted;
- a **step timeline** — every seed step as a bar, which is usually how you find out that a run
  spent most of its time waiting for a channel to reach `ChannelReady`;
- an **RPC table** — every call with its duration, filterable by node, by method, by text, or
  down to errors only, and expandable to the raw params and response.

Two properties it holds on purpose:

- **It is read-only and never talks to a node.** Its only source is the run-log JSON. That is
  not a limitation but the point: containers bind no host ports by default, the temporary port
  maps close on `reset`, and after a reset the run-log is the only surviving record of the run.
  The CLI stays the single control surface, so everything a cluster is ever asked to do lands in
  a run-log.
- **`--html` is always one self-contained file**, never a folder — all data and styles inlined.
  It opens over `file://`, so you can archive it as a CI artifact or attach it to an issue
  without needing a server to read it back.

A run-log written before the viewer existed still renders; it just has no topology graph and no
RPC durations, since `channels` and `durationMs` were added on 2026-09-22.

### list

```bash
fiber-lab list [--json]
```

Lists every available scenario (built-in scenarios plus any in the current directory's
`topology/scenarios`, if present) with its description, and every run recorded in
`.fiber-lab/runs` with its status. A scenario file that fails validation is still listed, with
`valid: false` and the validation error, instead of crashing the command.

## Scenario file reference

A scenario is a YAML file describing a topology, a sequence of actions, and the expected
outcome. Full field reference:

```yaml
name: string                      # required, must match the file name (without .yaml)
description: string                # optional, shown by `list`

nodes: [string, ...]               # required, at least one node name

channels:                          # optional, defaults to []
  - from: string                   # required, must be one of `nodes`
    to: string                     # required, must be one of `nodes`, different from `from`
    capacity: number                # required, CKB units, minimum 100
    asset: CKB | RUSD               # optional, defaults to CKB
    push: number                    # optional, currently unused by the seeder

seed:                               # optional, defaults to []
  - action: send_payment | new_invoice | wait | kill_node | start_node
    from: string                    # send_payment: required
    to: string                      # send_payment, new_invoice: required
    amount: number                  # send_payment, new_invoice: required
    asset: CKB | RUSD                # send_payment: optional, defaults to CKB
    useInvoice: boolean               # send_payment: optional; pay the last new_invoice to `to`
                                       # instead of a keysend payment
    expiresInSec: number              # new_invoice: optional invoice expiry
    durationSec: number               # wait: required
    node: string                      # kill_node, start_node: required, must be one of `nodes`

expect:
  status: succeeded | failed         # required
  reason: ErrorCategory               # optional, only allowed when status is failed
  routeHops: number                   # optional, non-negative integer
```

Validation rules enforced before any Docker resource is created:

- `name` must equal the file's base name.
- Every node referenced in `channels` and `seed` must be declared in `nodes`.
- A channel cannot connect a node to itself.
- `capacity` must be at least 100 CKB (the node's minimum funding amount).
- `expect.reason` can only be set when `expect.status` is `failed`.

Amounts are interpreted in CKB units for the `CKB` asset, and in raw token units for `RUSD`.

### Seed actions

| Action | Required fields | Effect |
|---|---|---|
| `send_payment` | `from`, `to`, `amount` | Sends a keysend payment, or pays the last `new_invoice` issued to `to` when `useInvoice: true`. Failures are recorded, not thrown, so the scenario can continue and `expect` can assert on them. |
| `new_invoice` | `to`, `amount` | Creates an invoice on node `to`. Combine with `useInvoice: true` on a later `send_payment` to pay it. |
| `wait` | `durationSec` | Sleeps for the given duration, most commonly used to let an invoice expire. |
| `kill_node` | `node` | Forcibly kills the node's container (`docker kill`), simulating an abrupt peer disconnect. |
| `start_node` | `node` | Restarts a previously killed container and waits for it to become healthy again. |

## Built-in scenarios

These scenario names can be passed directly to `fiber-lab up`, `setupScenario`, or `seed`
without a file path.

| Name | Nodes | Expected result | What it exercises |
|---|---|---|---|
| `direct-channel` | alice, bob | succeeded | A single direct payment. Deterministic across repeated runs. |
| `two-hop-route` | alice, bob, charlie | succeeded, routeHops: 1 | A payment routed through one intermediary. Verified by a non-zero routing fee. |
| `round-trip` | alice, bob | succeeded | Two payments over the same channel in opposite directions. |
| `multi-asset` | alice, bob | succeeded | A payment in RUSD (sUDT) over a UDT-funded channel; the seeder mints the token before opening the channel. |
| `insufficient-capacity` | alice, bob | failed, reason: insufficient_outbound | A payment larger than the sender's outbound balance. |
| `channel-drain` | alice, bob | failed, reason: insufficient_outbound | Five payments in sequence; the first four succeed and deplete outbound liquidity until the fifth fails. |
| `two-hop-bottleneck` | alice, bob, charlie | failed, reason: no_route_found | The intermediary hop's channel capacity is too small to forward the payment. |
| `peer-offline` | alice, bob | failed, reason: peer_offline | The receiving node is killed before the payment is sent. |
| `expired-invoice` | alice, bob | failed, reason: invoice_expired | An invoice is paid after its expiry has passed. |

## Writing a custom scenario

Any project can define its own scenario YAML files instead of, or alongside, the built-in
ones. Pass a path ending in `.yaml`/`.yml`, or containing a path separator, anywhere a
scenario name is accepted; it is resolved relative to the current working directory.

```yaml
# scenarios/checkout.yaml
name: checkout
description: A customer pays a merchant over a direct channel
nodes: [customer, merchant]
channels:
  - from: customer
    to: merchant
    capacity: 500
seed:
  - action: send_payment
    from: customer
    to: merchant
    amount: 120
expect:
  status: succeeded
```

```bash
npx fiber-lab up ./scenarios/checkout.yaml
```

```typescript
const ctx = await setupScenario("./scenarios/checkout.yaml");
```

## test-kit API reference

Import from `fiber-test-lab/test-kit`. Every helper polls the relevant RPC with the interval
and timeout configured in `fiber-lab.config.ts` (default: 1 second interval, 60 second
timeout), because FNN does not push events over its HTTP RPC.

```typescript
import {
  setupScenario,
  expectPaymentSucceeds,
  expectPaymentFails,
  expectChannelState,
  subscribePayments,
} from "fiber-test-lab/test-kit";
```

### setupScenario

```typescript
function setupScenario(
  name: string,
  options?: { keep?: boolean },
): Promise<ScenarioContext>
```

Builds the topology, opens the declared channels, runs the seed steps, and verifies `expect`,
exactly like `fiber-lab up`. Does not tear anything down on success or on an expectation
mismatch; call `ctx.reset()` explicitly when done. On a runtime failure inside the seed steps,
it tears down automatically unless `options.keep` is `true`.

Parameters:

- `name` -- a built-in scenario name, or a path to a `.yaml` file (see Writing a custom
  scenario).
- `options.keep` -- when `true`, containers are left running after a runtime failure for
  debugging, instead of being torn down.

Returns a `ScenarioContext`.

Typical use:

```typescript
const ctx = await setupScenario("direct-channel");
try {
  await expectPaymentSucceeds(ctx);
} finally {
  await ctx.reset();
}
```

### ScenarioContext

The object returned by `setupScenario`.

```typescript
interface ScenarioContext {
  runId: string;
  network: string;
  scenario: Scenario;
  expectation: ExpectationResult | null;
  store: RunLogStore;
  endpoints: Record<string, string>;
  lastPaymentId: string | null;
  lastPaymentFrom: string | null;
  call(node: string, method: string, params?: unknown[]): Promise<unknown>;
  watchPayments(node: string): Promise<PaymentWatcher>;
  reset(): Promise<void>;
}
```

- `runId` -- the unique identifier for this run. Also usable with `fiber-lab logs <runId>`.
- `network` -- the isolated Docker network name for this run.
- `scenario` -- the parsed scenario definition (nodes, channels, seed, expect).
- `expectation` -- the result of comparing the scenario's `expect` block against what
  actually happened, or `null` if the scenario had no `send_payment` steps. Shape:
  `{ match: boolean, expected: "succeeded" | "failed", actual: "succeeded" | "failed",
  reason?: { expected, actual, match }, routeHops?: { expected, actual, match } }`.
- `store` -- the run-log store; `store.data` is the full run-log object (see Run-log
  reference).
- `endpoints` -- the host-mapped RPC endpoint for each node, keyed by node name, for example
  `{ alice: "http://127.0.0.1:32812" }`.
- `lastPaymentId` -- the `payment_hash` of the most recent `send_payment` step, or `null` if
  that payment failed synchronously and never received a hash (this happens for failures like
  `insufficient_outbound` and `peer_offline`, which FNN rejects before creating a payment
  record).
- `lastPaymentFrom` -- the node name that sent the most recent payment.
- `call(node, method, params)` -- makes a raw JSON-RPC call to the named node and logs it to
  the run-log, for scenario steps or assertions not covered by the built-in helpers.
- `watchPayments(node)` -- opens a WebSocket subscription on the given node (see
  subscribePayments below).
- `reset()` -- tears down every Docker resource for this run. Does not delete the run-log file.

### expectPaymentSucceeds

```typescript
function expectPaymentSucceeds(
  ctx: ScenarioContext,
  paymentId?: string | null,
): Promise<void>
```

Polls `get_payment` on the sending node until the payment reaches a terminal status, and
throws if that status is not `Success`.

Parameters:

- `ctx` -- the context returned by `setupScenario`.
- `paymentId` -- the payment hash to check. Defaults to `ctx.lastPaymentId`.

What it verifies: that a payment settled successfully. Use this for scenarios expected to
succeed, such as `direct-channel`, `two-hop-route`, `round-trip`, and `multi-asset`.

On failure, the thrown error message includes the path to the run-log file for the run, since
the containers may still be running and the run-log is the durable record either way.

### expectPaymentFails

```typescript
function expectPaymentFails(
  ctx: ScenarioContext,
  paymentId?: string | null,
  reason?: ErrorCategory,
): Promise<void>
```

Asserts that a payment failed, and optionally that it failed for a specific classified reason.

Parameters:

- `ctx` -- the context returned by `setupScenario`.
- `paymentId` -- the payment hash to check. Defaults to `ctx.lastPaymentId`. When this is
  `null` (a payment that failed synchronously, see `lastPaymentId` above), the function reads
  the recorded error from the run-log directly instead of polling.
- `reason` -- one of the `ErrorCategory` values (see Error category reference). When given,
  the raw failure is classified and compared against this value; the assertion fails if they
  do not match.

What it verifies: that a payment failed, and that it failed for the expected reason rather
than some other cause. Use this for scenarios expected to fail, such as
`insufficient-capacity` (reason `insufficient_outbound`), `peer-offline` (reason
`peer_offline`), `expired-invoice` (reason `invoice_expired`), and `two-hop-bottleneck`
(reason `no_route_found`).

```typescript
const ctx = await setupScenario("insufficient-capacity");
try {
  await expectPaymentFails(ctx, ctx.lastPaymentId, "insufficient_outbound");
} finally {
  await ctx.reset();
}
```

### expectChannelState

```typescript
function expectChannelState(
  ctx: ScenarioContext,
  channelId: string,
  expected: { status?: string; capacity?: number },
): Promise<void>
```

Polls `list_channels` across every node in the scenario until the channel is found and its
state matches, then optionally checks its capacity.

Parameters:

- `ctx` -- the context returned by `setupScenario`.
- `channelId` -- the channel id to check, typically obtained by calling
  `ctx.call(node, "list_channels", [{}])` first.
- `expected.status` -- the expected `state_name`, for example `"ChannelReady"`. When given,
  this function polls until the channel reaches that state or the timeout elapses.
- `expected.capacity` -- the expected total channel capacity in CKB. Computed as the sum of
  the channel's local and remote balances plus the fixed reserve (99 CKB), since `FNN`'s
  `list_channels` response does not include the original funding amount directly.

What it verifies: that a channel reached a specific lifecycle state (most commonly
`ChannelReady`) and, optionally, that it was funded with the expected capacity.

```typescript
const ctx = await setupScenario("direct-channel");
try {
  const { channels } = (await ctx.call("alice", "list_channels", [{}])) as {
    channels: { channel_id: string }[];
  };
  await expectChannelState(ctx, channels[0].channel_id, { status: "ChannelReady", capacity: 500 });
} finally {
  await ctx.reset();
}
```

### subscribePayments and ctx.watchPayments

```typescript
function subscribePayments(endpoint: string, config: GlobalConfig): Promise<PaymentWatcher>

interface PaymentWatcher {
  wait(hash: string): Promise<{ status: string }>;
  close(): void;
}
```

Opens a WebSocket connection to a node's `subscribe_store_changes` RPC and resolves payment
status changes as they are pushed by the node, instead of polling `get_payment` on an
interval. `ctx.watchPayments(node)` is the convenient form that resolves the node's endpoint
and the current configuration automatically; call it before sending the payment so no event
is missed.

Parameters:

- `endpoint` -- the node's RPC endpoint (also used as the WebSocket endpoint; FNN serves both
  on the same port).
- `config` -- the loaded `GlobalConfig`, used for the wait timeout.

`PaymentWatcher.wait(hash)` resolves with `{ status: "Success" | "Failed" }` once that
terminal event arrives, or rejects after the configured timeout.

What it verifies: the same outcome as polling `get_payment`, but event-driven, which is
useful when a test needs to react to a payment settling without a fixed polling interval.

```typescript
const ctx = await setupScenario("direct-channel");
const watcher = await ctx.watchPayments("alice");
try {
  const bob = (await ctx.call("bob", "node_info")) as { pubkey: string };
  const res = (await ctx.call("alice", "send_payment", [
    { target_pubkey: bob.pubkey, amount: "0x2540be400", keysend: true },
  ])) as { payment_hash: string };
  const final = await watcher.wait(res.payment_hash);
  // final.status === "Success"
} finally {
  watcher.close();
  await ctx.reset();
}
```

## Error category reference

`expect.reason` in a scenario file, and the `reason` parameter of `expectPaymentFails`, both
take one of the following values. FNN always returns JSON-RPC error code -32000 regardless of
the underlying cause, so `fiber-test-lab` classifies failures by matching known substrings in
the raw error message, plus one out-of-band signal for peer connectivity.

| Value | Verified against a live node | Classification signal |
|---|---|---|
| `insufficient_outbound` | Yes | Raw message contains "Insufficient balance" or "max outbound liquidity ... insufficient". |
| `no_route_found` | Yes | Raw message contains "PathFind error: no path found". |
| `peer_offline` | Yes | The target is no longer present in the sending node's `list_peers`, checked at the moment the payment fails. This takes priority over the message text, because an offline peer produces the same "max outbound liquidity 0" message as `insufficient_outbound`. |
| `invoice_expired` | Yes | Raw message contains "invoice is expired". |
| `insufficient_inbound` | No | Reserved; no live scenario reproduces this yet. |
| `amount_out_of_range` | No | Reserved; no live scenario reproduces this yet. |
| `asset_mismatch` | No | Reserved; no live scenario reproduces this yet. |
| `channel_not_ready` | No | Reserved; no live scenario reproduces this yet. |
| `reserve_violation` | No | Reserved; no live scenario reproduces this yet. |

Only pass a value from this list as `reason` in `expect` or as the third argument to
`expectPaymentFails`; anything else will fail zod validation (in a scenario file) or simply
never match (as a runtime argument).

## Run-log reference

Every run writes a JSON file to `.fiber-lab/runs/<runId>.json`, relative to the current
working directory of the process that called `setupScenario` or ran the CLI. This file is the
durable record of what happened during a run; it survives `reset`, since only Docker resources
are torn down, not the log.

```typescript
interface RunLog {
  runId: string;
  scenario: string;
  status: "running" | "completed" | "failed" | "reset";
  startedAt: string;
  finishedAt: string | null;
  network: string;
  nodes: { name: string; container: string | null; endpoint: string | null }[];
  steps: { action: string; input: unknown; result: unknown; at: string }[];
  rpcCalls: { node: string; method: string; params: unknown; response: unknown; error: unknown; at: string }[];
  error: string | null;
}
```

`steps` records one entry per seed action and per `open_channel`; `rpcCalls` records every
single RPC request and response or error made during the run, in order, which is the primary
tool for debugging a scenario after the containers are gone.

Inspect a run-log with the CLI:

```bash
npx fiber-lab logs <runId>          # summary
npx fiber-lab logs <runId> --rpc    # every RPC call
npx fiber-lab logs <runId> --json   # the raw file
```

Or read the file directly, or access `ctx.store.data` from within a test that still holds the
`ScenarioContext`.

## Determinism and version pinning

The same scenario, run against the same pinned versions, produces the same result. This
depends entirely on the pinned versions listed above; results observed against a different
FNN or `@ckb-ccc` version should not be assumed to hold, and should be re-verified. Each
scenario builds an isolated Docker network and container set per run-id, so parallel or
repeated runs do not interfere with each other, and `reset --all` removes any leftover
resources from a run that failed to tear down on its own.

## License

MIT. See [LICENSE](LICENSE).
