---
type: data_dictionary
version: 1.0
last_updated: 2026-09-22
tags: [yaml, zod, scenario, run-log, schema]
---

# Data Dictionary — Scenario Schema + Run-log

> Test Lab has no database. Its "data" comes in two kinds: **scenario YAML files** (input, written by a developer) and **run-log JSON** (output, written by the system). This file defines both. Every YAML file must validate with `zod` against the schema below before use.

## 1. Scenario file (`topology/scenarios/<name>.yaml`)

### Overall structure
```yaml
name: string                 # scenario identifier, matches the file name
description: string          # short description, shown by `fiber-lab list`
tags: string[]               # optional, selects scenarios for `fiber-lab test --tag`
chain: { mining }            # optional; mining: manual (default) | auto
nodes: string[]              # node names, e.g. [alice, bob, carol]
channels: Channel[]          # channels opened as part of the seed
seed: SeedStep[]             # actions run once the topology is ready
expect: Expectation          # the expected outcome of the payments; optional if a step declares its own
```

### The `Channel` type
| Field | Type | Required | Description |
|---|---|---|---|
| from | string | yes | The node opening the channel (must be in `nodes`) |
| to | string | yes | The counterparty node (must be in `nodes`) |
| capacity | number | yes | Capacity (CKB) node `from` locks into the channel |
| asset | "CKB" \| "RUSD" | | Defaults to "CKB" |

### The `SeedStep` type
| Field | Type | Description |
|---|---|---|
| action | "send_payment" \| "await_payment" \| "new_invoice" \| "settle_invoice" \| "cancel_invoice" \| "close_channel" \| "disconnect_peer" \| "connect_peer" \| "wait" \| "kill_node" \| "start_node" \| "pause_node" \| "resume_node" \| "mine" \| "advance_epochs" \| "assert" | The action |
| from | string | The node performing it (send_payment, await_payment, close_channel, disconnect_peer, connect_peer) |
| to | string | The target node |
| amount | number | The amount (send_payment/new_invoice) |
| asset | "CKB" \| "RUSD" | Defaults to "CKB" |
| expiresInSec | number | For new_invoice — set a short expiry to test it |
| node | string | For kill_node/start_node/pause_node/resume_node, and the invoice's owner for settle_invoice/cancel_invoice |
| durationSec | number | For wait — how long to wait |
| useInvoice | boolean | For send_payment — pay the last invoice created by `to` instead of a keysend |
| blocks | number | For mine — how many blocks (default 1) |
| epochs | number | For advance_epochs — how many epochs |
| hold | boolean | For new_invoice — the payment waits, locked, for settle_invoice or cancel_invoice |
| finalExpiryDeltaSec | number | For new_invoice — FNN's `final_expiry_delta`. Omitted, FNN uses its minimum |
| waitFor | "final" \| "inflight" | For send_payment — "inflight" returns once the payment is on its way (default "final") |
| timeoutSec | number | For send_payment, await_payment — how long to watch before reporting "timeout" (default `pollTimeoutMs`) |
| wrongPreimage | boolean | For settle_invoice — settle with a preimage that cannot match, to test the refusal |
| force | boolean | For close_channel — a unilateral close |
| expect | StepExpectation | What this step should have produced. Required on assert |

### The `StepExpectation` type
| Field | Type | Description |
|---|---|---|
| status | "succeeded" \| "failed" \| "inflight" \| "timeout" | send_payment, await_payment. See below |
| reason | ErrorCategory | send_payment, await_payment; requires status "failed" |
| fee | AmountMatcher | send_payment, await_payment |
| error | string | settle_invoice, cancel_invoice, close_channel: the step must be refused with a message containing this (any case). Without it, a refusal fails the scenario |
| balances | BalanceCheck[] | Channel balances after the step |
| channels | ChannelCheck[] | Channel states after the step |
| peers | PeerCheck[] | Whether a node is connected to a peer |
| invoices | InvoiceCheck[] | The status of each node's last invoice |
| onchain | OnchainCheck[] | What each node's default lock owns on-chain |

A payment has four outcomes. `failed` means FNN said so, or rejected it outright. `inflight` means a step with `waitFor: inflight` left it on its way on purpose. `timeout` means the step stopped watching and FNN had not decided: the payment may still settle, so it is never reported as a failure.

`AmountMatcher` is an exact number or `{ min?, max? }`, in CKB, or base units for a UDT.

- **BalanceCheck:** `node`, optional `peer` (omitted: all the node's channels in that asset), `asset` (default "CKB"), and at least one of `local`, `remote`, `localDelta`, `remoteDelta`, `offered`, `received`. Balances exclude the reserve and closed channels. `offered` and `received` are the amounts locked in unsettled TLCs: `local` does not drop until a held payment settles. A delta compares with the state just before the step, so it is not valid on an assert step.
- **ChannelCheck:** `node`, `peer`, `state` (an FNN state name, e.g. "ChannelReady"), optional `flags` (a substring of FNN's state flags, e.g. "COOPERATIVE").
- **PeerCheck:** `node`, `peer`, `connected`.
- **InvoiceCheck:** `node`, `status` ("Open", "Cancelled", "Expired", "Received", "Paid").
- **OnchainCheck:** `node`, and at least one of `capacity`, `capacityDelta`.

### The `Expectation` type
| Field | Type | Description |
|---|---|---|
| status | "succeeded" \| "failed" | The expected final payment outcome |
| reason | ErrorCategory | If failed — the expected error code (see the glossary) |
| routeHops | number | The expected number of intermediary hops (e.g. 1 for A-B-C) |

### A full example
```yaml
name: insufficient-capacity
description: The payment fails because outbound liquidity is insufficient
nodes: [alice, bob]
channels:
  - { from: alice, to: bob, capacity: 50 }
seed:
  - action: send_payment
    from: alice
    to: bob
    amount: 500
expect:
  status: failed
  reason: insufficient_outbound
```

## 2. Run-log (`.fiber-lab/runs/<run-id>.json`)

Records an entire `fiber-lab up` run so it can be debugged after the containers have been reset.

| Field | Type | Description |
|---|---|---|
| runId | string | The run's unique identifier |
| scenario | string | The name of the scenario that ran |
| status | "running" \| "completed" \| "failed" \| "reset" | The overall status |
| startedAt | ISO8601 | When it started |
| finishedAt | ISO8601 \| null | When it finished |
| network | string | The Docker network name (flab_<run-id>) |
| versions | { fnn, ckb }? | Optional (added in 1.2). The versions this run actually used; a result only holds for these |
| nodes | NodeRecord[] | The node list + container names + temporary port maps (if any) |
| steps | StepRecord[] | Each seed step: action, input, result |
| rpcCalls | RpcRecord[] | Every outgoing RPC call: method, params, raw response/error |
| error | string \| null | The overall error, if any |

### The `RpcRecord` type (important for debugging)
| Field | Type | Description |
|---|---|---|
| node | string | The RPC's target node |
| method | string | e.g. open_channel, send_payment |
| params | object | The parameters sent |
| response | object \| null | The raw result |
| error | object \| null | The raw error from the node (kept as-is for debugging) |
| at | ISO8601 | When the call was made |
| durationMs | number? | Optional (added 2026-09-22). Wall-clock time of the call, for the run viewer's latency view. Absent in run-logs written before that date. |

### The `StepRecord` type
| Field | Type | Description |
|---|---|---|
| action | string | The seed action that ran (open_channel, send_payment, wait, …) |
| input | object \| null | The step's input as declared in the scenario |
| result | object \| null | The outcome |
| at | ISO8601 | When the step ran |
| checks | CheckResult[]? | Optional (added in 1.2). What the step's `expect` found: `{ check, expected, actual, match }` |
| channels | ChannelSnapshot[]? | Optional (added 2026-09-22). Every node's view of its channels right after this step, so the run viewer can draw the topology directly instead of reverse-engineering it from `list_channels` responses scattered through `rpcCalls`. Only recorded for steps that change balances (open_channel, send_payment). |

### The `ChannelSnapshot` type
| Field | Type | Description |
|---|---|---|
| node | string | The node whose view this is |
| peer | string \| null | The counterparty's node name, or null if its pubkey maps to no node in the scenario |
| channelId | string | FNN's `channel_id` — the same on both sides, so the two views pair up |
| state | string | FNN's `state.state_name` (e.g. ChannelReady) |
| asset | string | "CKB", or the UDT asset when the channel is UDT-funded |
| localBalance | string \| null | Decimal string in base units (shannon for CKB) — FNN returns hex, and UDT amounts can exceed `Number.MAX_SAFE_INTEGER` |
| remoteBalance | string \| null | Same, from this node's point of view |
| offeredBalance, receivedBalance | string \| null? | Optional. Locked in unsettled TLCs, same units |
| stateFlags | string \| null? | Optional. FNN's `state_flags`, e.g. "COOPERATIVE" |

> The run-log is the "source of truth" for understanding why a test failed — once `reset` has run, the containers are gone and can no longer be asked.

## 3. Validation rules (zod)

- Unknown keys are rejected at every level, so a misspelled field fails validation instead of being ignored.
- `channels[].from`/`to`, and every node named in `seed` (including inside `expect`), must be within `nodes` — otherwise: a clear error, "node X is not declared in nodes".
- Amounts must be exact in base units: at most 8 decimals for CKB, a whole number for a UDT.
- A scenario with a seed must declare at least one expectation, and a top-level `expect` needs a `send_payment` to describe. A scenario with no seed is an environment and needs none.
- `status`, `reason` and `fee` on a step only apply to `send_payment` and `await_payment`; `error` only to the steps that can be refused.
- `hold`, `finalExpiryDeltaSec`, `waitFor`, `timeoutSec`, `wrongPreimage` and `force` are rejected on any action they do not apply to.
- `status: inflight` requires `waitFor: inflight`, and `status: timeout` rules it out.
- A top-level `expect` describes finished payments, so a seed that leaves one in flight must declare `expect` on its steps.
- The node count must be within `maxNodesPerScenario` and the accounts funded in genesis; a node cannot be named "ckb".
- `capacity` must be above the minimum reserve (99 CKB per side — see the glossary), or the channel will be rejected.
- `expect.reason` may only be set when `expect.status === "failed"`.
- The scenario's `name` should match its file name, to avoid confusion.
