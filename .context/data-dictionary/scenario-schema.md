---
type: data_dictionary
version: 1.0
last_updated: 2026-07-04
tags: [yaml, zod, scenario, run-log, schema]
---

# Data Dictionary — Scenario Schema + Run-log

> Test Lab has no database. Its "data" comes in two kinds: **scenario YAML files** (input, written by a developer) and **run-log JSON** (output, written by the system). This file defines both. Every YAML file must validate with `zod` against the schema below before use.

## 1. Scenario file (`topology/scenarios/<name>.yaml`)

### Overall structure
```yaml
name: string                 # scenario identifier, matches the file name
description: string          # short description, shown by `fiber-lab list`
nodes: string[]              # node names, e.g. [alice, bob, carol]
channels: Channel[]          # channels opened as part of the seed
seed: SeedStep[]             # actions run once the topology is ready
expect: Expectation          # the expected outcome (used by test-kit + self-verification)
```

### The `Channel` type
| Field | Type | Required | Description |
|---|---|---|---|
| from | string | yes | The node opening the channel (must be in `nodes`) |
| to | string | yes | The counterparty node (must be in `nodes`) |
| capacity | number | yes | Capacity (CKB) node `from` locks into the channel |
| asset | "CKB" \| "RUSD" | | Defaults to "CKB" |
| push | number | | CKB pushed to `to` on open (creates inbound for `from`) |

### The `SeedStep` type
| Field | Type | Description |
|---|---|---|
| action | "send_payment" \| "new_invoice" \| "wait" \| "kill_node" \| "start_node" | The action |
| from | string | The node performing it (for send_payment) |
| to | string | The target node |
| amount | number | The amount (send_payment/new_invoice) |
| asset | "CKB" \| "RUSD" | Defaults to "CKB" |
| expiresInSec | number | For new_invoice — set a short expiry to test it |
| node | string | For kill_node/start_node — the affected node |
| durationSec | number | For wait — how long to wait |

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

> The run-log is the "source of truth" for understanding why a test failed — once `reset` has run, the containers are gone and can no longer be asked.

## 3. Validation rules (zod)

- `channels[].from`/`to` must be within `nodes` — otherwise: a clear error, "node X is not declared in nodes".
- `capacity` must be above the minimum reserve (99 CKB per side — see the glossary), or the channel will be rejected.
- `expect.reason` may only be set when `expect.status === "failed"`.
- The scenario's `name` should match its file name, to avoid confusion.
