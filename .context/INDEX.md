---
type: index
version: 1.0
last_updated: 2026-07-04
---

# Fiber Test Lab — Context Index

This is the Single Source of Truth for the whole project. Claude Code should read this file first.

## What is this project?

**Fiber Test Lab** is a **fully local** test environment for Fiber Network (the CKB blockchain), built with a single command, that lets developers **reproduce** and **control** common payment/routing scenarios (a direct channel, a multi-hop route, insufficient capacity, an expired invoice, a peer going offline) — with a CLI to build/seed/reset each scenario, and an assertion library (`test-kit`) for writing automated integration tests.

Developers building apps on Fiber (wallets, merchant gateways, games, agents...) currently **cannot write automated tests** for their payment logic, because the only way to hit payment-channel failure scenarios is to create them for real on a public testnet — slow, shared, non-reproducible, and impossible to force on demand. Fiber Test Lab solves exactly that problem.

> **Naming and positioning note:** this is NOT a new Fiber node, NOT a wallet, NOT an end-user app. It is **developer tooling / a local testing environment** — it directly matches the example *"Local testing environments, developer CLIs, and test suites for common Fiber payment and routing scenarios"* under **Category 2** of the hackathon.

Built for the **Gone in 60ms: Fiber Network Infrastructure Hackathon** (1–15 July 2026), category: **Node, Routing, Cross-Chain, and Diagnostics Infrastructure**.


## Context tree

| File | Content |
|------|----------|
| `business-context/project-vision.md` | Vision, the problem, scope, out-of-scope, trade-offs |
| `architecture/system-design.md` | **Detailed architecture** — tech stack, topology, data flow, run-id isolation, repo layout, two-tier config. Read most carefully. |
| `data-dictionary/scenario-schema.md` | The scenario YAML schema + the run-log JSON schema (in place of a database schema) |
| `api/cli-spec.md` | Full CLI specification (commands, parameters, output, exit codes) — in place of a REST API |
| `business-rules/scenario-rules.md` | Rules for running scenarios, polling, isolation, cleanup |
| `glossary/fiber-terms.md` | Fiber and Test Lab terminology |
| `user-stories/developer-flows.md` | User stories from the perspective of a developer using Test Lab |
| `processes/decisions-log.md` | Architecture/business decisions confirmed by a human |
| `processes/definition-of-done.md` | Definition of Done + a self-verification checklist for the end of each session |

## Repo layout

```
fiber-test-lab/
├── topology/          — docker-compose + scenario YAML files
├── cli/               — the fiber-lab CLI (commander)
├── test-kit/          — assertion helpers for Vitest
├── lib/               — the Fiber RPC client wrapper, Docker orchestration, run-log, run viewer
├── fiber-lab.config.ts — global config (tier-2 settings)
└── docs/              — scenario-catalog.md, README
```

## Code conventions

- TypeScript strict mode throughout
- Function names: camelCase. Type/interface names: PascalCase
- CLI command handlers are separated from business logic (thin handlers, logic lives in `lib/`)
- Every input coming from a YAML file must be validated with `zod` BEFORE use — fail fast with a clear message
- Never hardcode ports or container names — derive them from the run-id (see system-design)
- Every Docker operation must be cleanable via `fiber-lab reset` — no leftover resources
