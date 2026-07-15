---
type: glossary
domain: fiber-network + testing
version: 1.0
last_updated: 2026-07-04
tags: [fiber, ckb, payment-channel, testing]
---

# Glossary — Fiber Test Lab

## Fiber terms (foundational)

## Fiber Network
A P2P payment-channel network on Nervos CKB. Similar to Bitcoin Lightning but multi-asset (CKB, RUSD, UDT).

## FNN (Fiber Network Node)
The reference implementation of the Fiber protocol (Rust). Test Lab runs several REAL FNN binaries in containers. A release includes 2 binaries: `fnn` (HTTP RPC + node maintenance) and `fnn-cli` (a management CLI). Source: github.com/nervosnetwork/fiber.

## fnn-cli (subcommand structure)
A node-management CLI using a **subcommand** style (verified from the docs):
- `fnn-cli info` — node info
- `fnn-cli peer list_peers` — the peer list
- `fnn-cli channel list_channels` — the channel list
(NOT flat commands like `fnn-cli open_channel`.)

## fiber-demo-startup
The official repo (github.com/HappySonnyDev/fiber-demo-startup, branch `demo-0.8`) — a docker-compose that builds a local CKB dev chain + several Fiber nodes (1 bootnode + 3 nodes + a funding transfer container) + a Next.js demo app. **Test Lab builds ON TOP of this repo** (forking its proven Docker infrastructure, adding a scenario/seeder/test-kit/CLI layer). demo-startup is "interactive learning"; Test Lab turns it into "automated testing".

## Payment Channel
A direct relationship between two nodes. Opening it = locking CKB on-chain into a Funding Cell (multisig). Transactions happen off-chain. Closing it = settling on-chain.

## Capacity (inbound / outbound)
Channel capacity is split by DIRECTION, not a single number:
- **Outbound** = what can be SENT
- **Inbound** = what can be RECEIVED
Each payment decreases outbound / increases inbound on the payer's side. Each side reserves a minimum of **99 CKB** (not usable for payments).

## HTLC (Hash Time-Locked Contract)
The security mechanism for multi-hop payments: either every hop succeeds, or all of them revert.

## Multi-hop Route
A payment doesn't need a direct sender-receiver channel — it can go through an intermediary node if there's enough liquidity. E.g. A-B-C: A pays C through B (1 intermediary hop).

## Invoice
A payment request (a Bech32m string): amount, asset, payment_hash, expiry, description.

## Shannon
The smallest CKB unit. 1 CKB = 100,000,000 Shannon.

## Fiber RPC (methods Test Lab uses)
FNN's JSON-RPC 2.0 interface. The main methods Test Lab calls:
- `get_node_info` — check that a node is READY
- `open_channel` / `list_channels` / `close_channel`
- `new_invoice` / `get_invoice`
- `send_payment`
- `subscribe_store_changes` — (optional, v2) events instead of polling

## RUSD
A stablecoin on the CKB testnet (a UDT). Used for the multi-asset scenario (v2 stretch).

## ErrorCategory (Test Lab's normalized error codes)
The set of error codes Test Lab uses in `expect.reason`. The list:
`insufficient_outbound`, `insufficient_inbound`, `no_route_found`, `peer_offline`, `invoice_expired`, `amount_out_of_range`, `asset_mismatch`, `channel_not_ready`, `reserve_violation`.

FNN always returns JSON-RPC `code: -32000` (generic), so failures must be classified by a **substring of the `message`** — see `lib/scenario/errorCategory.ts::mapError()` and `docs/hands-on/rpc-notebook.md` sections 8/9. Mappings ALREADY verified against a real node (FNN 0.8.0):

| ErrorCategory | Classification signal | Verified in |
|---|---|---|
| `insufficient_outbound` | message: `Insufficient balance` / `max outbound liquidity … is insufficient` (the peer is STILL connected) | E0-5, E5-3 |
| `no_route_found` | message: `PathFind error: no path found` | E5-2 |
| `peer_offline` | **the target is no longer in `list_peers`** (an offline peer produces a message IDENTICAL to `insufficient_outbound`'s "max outbound liquidity 0" — the two must be distinguished by connectivity, not by message) | E8-2 |
| `invoice_expired` | message: `invoice is expired` (`InvalidParameter: Failed to validate payment request`) | E8-1 |

Because `peer_offline` shares its message with `insufficient_outbound`, classification goes through `classifyFailure()`: it prioritizes `peerConnected === false` -> `peer_offline`, and only falls back to `mapError()` by message otherwise. The remaining categories (`amount_out_of_range`, `asset_mismatch`, `channel_not_ready`, `reserve_violation`, `insufficient_inbound`) are **not yet verified**. Recording them officially in `decisions-log.md` requires human confirmation.

---

## Test Lab-specific terms

## Scenario
One YAML file declaring one test situation: topology (nodes + channels) + seed + expect. Tier-1 settings — a developer can write these without touching code.

## Topology
The node + channel configuration of a scenario. E.g. `two-hop-route` = 3 nodes A-B-C, 2 channels.

## Seed
The actions run once the topology is ready (sending a sample payment, creating an expired invoice, killing a node...).

## Run / run-id
One execution of `fiber-lab up`. Each run has a unique `run-id`, and every resource is prefixed by it for isolation.

## Run-log
A JSON file recording an entire run (steps + every raw RPC call). The source of truth for debugging after the containers have been reset.

## test-kit
The assertion library (used from Vitest): `expectPaymentSucceeds`, `expectPaymentFails`, `expectChannelState`.

## offckb
A tool for building a local CKB devnet + faucet. **Note:** the proven path is to use the CKB dev chain inside `fiber-demo-startup`'s docker-compose, not standalone offckb. offckb is only a fallback option if needed.

## Official documentation (reference sources)
- Hackathon onboarding: github.com/RetricSu/fiber-hackathon-docs
- Main docs: fiber.world/docs · How it works: /docs/how-it-works
- RPC reference: fiber.world/docs/api-reference
- Quick-start: /docs/quick-start/run-a-node · /basic-transfer · /transfer-stablecoin · /multi-hop-transfer (~ two-hop-route)
- JS SDK: fiber.world/docs/build/sdk/js (`@ckb-ccc/fiber`)
- FNN source: github.com/nervosnetwork/fiber · Fiber scripts: github.com/nervosnetwork/fiber-scripts
- Testnet faucet: faucet.nervos.org

## Global config (`fiber-lab.config.ts`)
Tier-2 settings — system-wide behavior (timeout, poll interval, image version). The developer edits it once.

## Determinism
Same scenario + same version -> same result. Flakiness is a Test Lab bug, not acceptable behavior.
