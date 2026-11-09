---
type: business_rules
module: scenario-execution
version: 1.0
last_updated: 2026-07-04
tags: [scenario, polling, isolation, cleanup]
---

# Business Rules — Scenario Execution

## Scenario Rules

**BR-SCN-001:** Every scenario must be validated with `zod` BEFORE touching Docker. A bad schema -> exit 1, print a clear error naming the offending field, create NO containers.

**BR-SCN-002:** `channels[].from`/`to` must be within `nodes`. A violation -> a validation error.

**BR-SCN-003:** Each channel's `capacity` must be above the minimum reserve (99 CKB per side) unless the scenario is DELIBERATELY testing a reserve failure — in which case `expect.reason` must reflect that.

**BR-SCN-004:** `expect.reason` is only valid when `expect.status === "failed"`.

**BR-SCN-005:** A scenario must declare at least one expectation, on the scenario or on a step. A top-level `expect` requires at least one `send_payment`. A scenario that checks nothing must not be able to pass.

**BR-SCN-006:** Unknown keys in a scenario are a validation error, and amounts must be exact in base units. `expect.reason` accepts only the categories a classifier can produce.

## Chain Rules

**BR-CHN-001:** In the default `manual` mode no miner runs: the chain advances only when the lab mines. Anything that waits on-chain must mine while it waits (`mineUntil`), and the chain stands still between steps.

**BR-CHN-002:** After mining and before anything that selects cells (a funding transaction, a mint), wait for the indexer to reach the tip. Blocks arrive faster than the indexer polls.

**BR-CHN-003:** Hashes that depend on the genesis (UDT cell dep, secp256k1 dep group) are read from block 0 of the running chain, never kept as constants. The chain therefore starts before the FNN nodes, whose config needs them.

## Topology / Isolation Rules

**BR-ISO-001:** Every `up` generates one unique `run-id`. Every resource (network, container, run-log, port map) is prefixed by the run-id.

**BR-ISO-002:** Containers/networks are NOT bound to the host by default — they only listen on the `flab_<run-id>` network. A temporary port map is only opened when the test-kit (outside Docker) needs to call RPC, and is closed on reset.

**BR-ISO-003:** The maximum number of nodes per scenario is limited to 3 (machine resources). Going higher requires a deliberate override in the global config, with a warning.

**BR-ISO-004:** Two parallel runs must NOT share a network/container. If a name collision is detected -> generate a new run-id, never overwrite the existing run.

## Readiness / Polling Rules

**BR-POL-001:** After `docker compose up`, wait for every node to be READY (poll `get_node_info` successfully) before seeding. Default timeout: `pollTimeoutMs`.

**BR-POL-002:** After `open_channel`, wait until BOTH sides report the channel READY (poll `list_channels`) before considering it open.

**BR-POL-003:** test-kit assertions (`expectPaymentSucceeds`...) and step state checks poll on `pollIntervalMs` until the result is reached or `pollTimeoutMs` elapses. Timing out without reaching the result -> fail the test with the run-log attached.

**BR-POL-004:** Every RPC call must be recorded to the run-log (method/params/response/error) — even on success — so it can be debugged after a reset.

## Cleanup Rules

**BR-CLN-001:** If `up` fails partway through, it must tear down everything it already created (unless `--keep`), leaving no leftover resources.

**BR-CLN-002:** `reset` must remove: the container, the network, the port map, the run's working directory, and mark the run-log `status: reset` (do NOT delete the run-log file — keep it as a historical record). Images are shared between runs and versioned, so a run never creates its own; `reset --images` removes them.

**BR-CLN-003:** `keepRunOnFailure: true` (global config) -> when a test fails, keep the container for debugging, and print guidance for `fiber-lab logs`/`reset`.

## Determinism Rules

**BR-DET-001:** The same scenario + the same FNN/offckb version must produce the same `expect` result. If it is flaky (passes sometimes, fails other times) -> treat it as a Test Lab bug (usually a missing wait for READY), not as acceptable behavior.

**BR-DET-002:** The FNN binary version + `@ckb-ccc/fiber` version must be pinned. A verified result is only considered valid for the version recorded in `scenario-catalog.md`. The run-log records the versions each run used.
