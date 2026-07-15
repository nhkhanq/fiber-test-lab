---
type: reference
version: 1.0
last_updated: 2026-07-04
tags: [prior-art, reference, compliance, reuse]
---

# Prior-Art & Reference — Fiber Test Lab

> A standalone reference file. It does NOT change decisions in the main context (system-design, decisions-log...).
> Purpose: record which repos are permitted to READ as reference, the legal boundary, and a map of "read which file to learn what".

---

## 1. Repos used as a reference oracle

This is REAL, running code — read to understand the correct RPC calls, parameters, and real errors, instead of guessing.

| Repo | What it is | Used as a reference for |
|---|---|---|
| `cryptape/ckb-py-integration-test` (branch `fiber`) | The team's Python QA suite for the FNN node itself | Correct RPC calls + parameters + real errors + the channel-opening/multi-hop flow |
| `HappySonnyDev/fiber-demo-startup` (branch `demo-0.8`) | A local environment: a docker-compose for the CKB dev chain + several FNN nodes | How to configure FNN + a CKB devnet in Docker |
| `nervosnetwork/fiber` | The official FNN source | The original RPC reference, node behavior |
| fiber.world/docs/api-reference | The official RPC docs | Cross-checking method names/parameters |

---

## 2. Legal boundary (IMPORTANT — read before using)

**None of the 3 repos above have a LICENSE file** (checked 2026-07-04). By default, copyright law then means "all rights reserved". As a result:

| Action | Allowed? | Note |
|---|---|---|
| READING the code to understand how something works | Yes | Copyright does not protect ideas/APIs/behavior |
| Learning RPC names + parameters + call order and **rewriting them yourself in TypeScript** | Yes | RPC names/parameters are "technical facts" needed to interoperate, not protectable creative expression |
| Copying the raw `docker-compose.yml`, `Dockerfile`, or Python code into this repo | No | Copying "expression" — no license means no permission. **WRITE your own compose/config.** |
| Running the official FNN binary / Docker image | Yes | It is published for use |

**The golden rule:** *Read to learn -> rewrite in your own words/code.* Never paste verbatim.

**3 things worth doing to be safe:**
1. Give credit in the README (see section 5).
2. Consider opening an issue asking the repo owner to add a license.
3. Read the hackathon's official rules on "building on existing repos" + confirm with the organizers if unclear.

**Side benefit:** writing your own code increases the hackathon's "original work" score, while keeping the benefit of "not afraid of getting it wrong" because there's a real running reference to check against.

---

## 3. A map of "read which file to learn what" (the reference oracle map)

| Need to know | Read this file (in cryptape/ckb-py-integration-test) |
|---|---|
| Exact RPC names + parameters | `framework/fiber_rpc.py` |
| How to start a node + connect a peer | `framework/basic_fiber.py` -> `Fiber.init_by_port()`, `start_new_fiber()` |
| Opening a channel + waiting for READY | `basic_fiber.py` -> `open_channel()`, `wait_for_channel_state(..., "CHANNEL_READY")` |
| Sending a payment + waiting for its status | `basic_fiber.py` -> `send_payment()`, `wait_payment_state()` |
| Multi-hop routing | `test_cases/fiber/devnet/send_payment_with_router/test_send_payment_with_router.py` -> `build_router`, `send_payment_with_router` |
| The real error text when a payment fails | the `try/except` blocks in the tests — e.g. "Failed to send onion packet". Used to finalize `ErrorCategory`. |
| Configuring FNN + a CKB devnet in Docker | `fiber-demo-startup`: `docker-compose.yml`, `fiber/Dockerfile`, `ckb/Dockerfile`, `fiber/transfer/` |

---

## 4. Primitives to PORT (minimal) vs. SKIP

Only port the minimal core needed to run the must-have scenarios. Do NOT port the whole suite (it would balloon in scope and blow the 11-day budget).

**PORT (minimal):**
- start a node · connect a peer
- `open_channel` + wait for `CHANNEL_READY`
- `new_invoice`
- `send_payment`
- `send_payment_with_router` (multi-hop, for `two-hop-route`)
- `wait_payment_state`
- catching payment errors (map them to `ErrorCategory`)

**SKIP (not relevant to must-have scenarios):**
- watchtower, abandon/update channel, compatibility, graph_*, password, remove_tlc...

**What's NEW on top (this is Test Lab's distinct value — not present in the Python suite):**
- A declarative **YAML** scenario layer (replacing 20-40 lines of imperative Python)
- **TS-native** assertions (`expectPaymentFails("insufficient_outbound")`) with normalized errors
- The `fiber-lab` CLI + run-id isolation + a JSON run-log

---

## 5. Sample attribution (paste into the README on submission)

```
## Prior art & credits
Fiber Test Lab was built as a TS-native, declarative, app-facing test harness.
It references (does not copy) the following open-source projects to ensure accuracy:
- cryptape/ckb-py-integration-test — a Python integration suite for FNN (referenced for RPC flow & errors).
- HappySonnyDev/fiber-demo-startup — a local Docker environment (referenced for how to configure FNN + a CKB devnet).
- nervosnetwork/fiber — the FNN reference implementation.
All code in this repo was written from scratch in TypeScript during the hackathon.
```

---

## 6. Measuring the delta (to stay honest in the submission)

- ~60% of the capability (bringing up nodes, sending payments, scenario coverage) already exists in Python in the cryptape suite.
- ~40% of what's new in Test Lab is: **declarative YAML + TS-native assertions + app-facing packaging** (in the spirit of "Polar for Fiber").
- The correct positioning: *"bringing a local, app-facing, declarative, TS-native testing pattern to Fiber"* — NOT claiming *"nobody has ever tested Fiber before"*.
