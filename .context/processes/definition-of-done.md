---
type: process
version: 1.0
last_updated: 2026-07-04
tags: [dod, checklist, quality]
---

# Definition of Done — Fiber Test Lab

## DoD for one feature/scenario

A scenario is considered "done" when:
- [ ] The YAML file validates through `zod` with no errors
- [ ] `fiber-lab up <scenario>` builds successfully, nodes reach READY
- [ ] `fiber-lab seed` runs every step, writing the full run-log
- [ ] The result matches `expect` **deterministically** (3 consecutive runs give the same result)
- [ ] `fiber-lab reset` cleans up completely, no leftover containers/networks
- [ ] It's described in `docs/scenario-catalog.md` (what it's for, known limitations)

## DoD for `test-kit`

- [ ] `expectPaymentSucceeds` / `expectPaymentFails` / `expectChannelState` all work
- [ ] Polling has a timeout, and a failure attaches the run-log for debugging
- [ ] At least one example test file in `test-kit/examples/` passes under Vitest
- [ ] The example test runs from a clean state (`git clone` -> `npm install` -> runs, with prerequisites documented)

## DoD for the whole project (submission)

- [ ] README: problem -> solution -> how to run (prerequisites: Docker, offckb, FNN version)
- [ ] All 3 must-have scenarios run end-to-end
- [ ] `docs/scenario-catalog.md` lists every scenario + its limitations + pinned versions
- [ ] A demo video (3-5 minutes): build a scenario -> run a passing/failing test -> view the run-log -> reset
- [ ] The repo is open source, with a LICENSE (MIT)
- [ ] Trade-offs are clearly documented: devnet ≠ mainnet, peer-offline simulated with docker kill, maintenance tied to the FNN version

## Self-verification checklist at the end of every coding session

- [ ] Does any new code validate YAML input through zod?
- [ ] Is there any Docker operation that `reset` cannot clean up?
- [ ] Is any port/container name hardcoded instead of derived from the run-id?
- [ ] Does the run-log record every RPC call (including successes) for debugging?
- [ ] Did this introduce a flaky test (a missing wait for READY)? — if so, treat it as a bug to fix.
- [ ] Update `decisions-log.md` if a new decision was confirmed by a human?
