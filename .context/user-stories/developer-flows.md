---
type: user_stories
persona: developer
version: 1.0
last_updated: 2026-07-04
tags: [testing, cli, integration-test]
---

# User Stories — A developer using Fiber Test Lab

## US-001: Quickly build a test topology
**As a** developer building an app on Fiber,
**I want to** build a multi-node Fiber network with one command,
**So that** I don't have to install/connect/open channels by hand every time I test.

**Acceptance:**
- `fiber-lab up two-hop-route` builds 3 nodes + 2 channels in under 1 minute
- It prints a run-id to use next
- No port is bound to the outside (safe)

## US-002: Write an integration test for payment logic
**As a** developer,
**I want to** write an automated test asserting "the payment fails for the right reason when capacity is insufficient",
**So that** I catch regressions in CI on every commit.

**Acceptance:**
```typescript
const ctx = await setupScenario("insufficient-capacity")
await expectPaymentFails(ctx, ctx.lastPaymentId, "insufficient_outbound")
await ctx.reset()
```
- Runs inside Vitest, no public testnet needed
- The result is deterministic (running it 10 times gives the same result)

## US-003: Create a new failure scenario without touching code
**As a** developer with a specific case,
**I want to** add one YAML file describing my situation,
**So that** I can extend the test suite without needing to understand the CLI's code.

**Acceptance:**
- Copy a sample scenario, adjust `capacity`/`amount`/`expect`
- `zod` reports an error immediately if the shape is wrong
- `fiber-lab up <my-scenario>` runs right away

## US-004: Debug why a test failed
**As a** developer,
**I want to** review every RPC call from a run even after its containers have been shut down,
**So that** I can understand exactly what the real node returned.

**Acceptance:**
- `fiber-lab logs <run-id> --rpc` prints every RPC call (method/params/response/raw error)
- The run-log survives `reset`
- `keepRunOnFailure: true` keeps the container around for deeper debugging when needed

## US-005: Tune system-wide behavior
**As a** developer,
**I want to** change the timeout/poll interval for every test at once,
**So that** it fits a slower machine or a CI runner.

**Acceptance:**
- Edit `fiber-lab.config.ts` in one place, and it applies to every scenario
- No need to edit each YAML file individually

## US-006: Clean up after testing
**As a** developer,
**I want to** remove every test container/network with one command,
**So that** my machine doesn't fill up with leftover Docker resources.

**Acceptance:**
- `fiber-lab reset --all` cleans up every run
- Nothing is left behind, even when a prior `up` failed partway through
