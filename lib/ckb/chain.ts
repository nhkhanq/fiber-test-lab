import { ccc } from "@ckb-ccc/core";
import { CKB_SERVICE, GENESIS_SIMPLE_UDT_INDEX } from "../constants";
import { jsonRpcCall, type RpcLogger } from "../fiber/jsonRpc";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface GenesisFacts {
  hash: string;
  simpleUdt: { codeHash: string; txHash: string; index: number };
  secp256k1DepGroup: { txHash: string; index: number };
}

export interface LockScript {
  code_hash: string;
  hash_type: string;
  args: string;
}

interface GenesisBlock {
  header: { hash: string };
  transactions: { hash: string; outputs_data: string[] }[];
}

export function parseGenesis(block: GenesisBlock): GenesisFacts {
  const cellbase = block.transactions[0];
  const depGroups = block.transactions[1];
  const udtData = cellbase?.outputs_data[GENESIS_SIMPLE_UDT_INDEX];
  if (!cellbase || !depGroups || !udtData) {
    throw new Error("Genesis block does not have the expected cellbase and dep-group transactions");
  }
  return {
    hash: block.header.hash,
    simpleUdt: { codeHash: ccc.hashCkb(udtData), txHash: cellbase.hash, index: GENESIS_SIMPLE_UDT_INDEX },
    secp256k1DepGroup: { txHash: depGroups.hash, index: 0 },
  };
}

export interface CkbChainOptions {
  endpoint: string;
  blockIntervalMs: number;
  logger?: RpcLogger;
  timeoutMs?: number;
}

export interface MineUntilOptions {
  label: string;
  timeoutMs: number;
  probeIntervalMs: number;
}

export class CkbChain {
  readonly endpoint: string;
  readonly #blockIntervalMs: number;
  readonly #logger?: RpcLogger;
  readonly #timeoutMs: number;

  constructor(options: CkbChainOptions) {
    this.endpoint = options.endpoint;
    this.#blockIntervalMs = options.blockIntervalMs;
    this.#logger = options.logger;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  call<T>(method: string, params: unknown[] = []): Promise<T> {
    return jsonRpcCall({
      node: CKB_SERVICE,
      endpoint: this.endpoint,
      method,
      params,
      timeoutMs: this.#timeoutMs,
      logger: this.#logger,
    }) as Promise<T>;
  }

  async tip(): Promise<bigint> {
    return BigInt(await this.call<string>("get_tip_block_number"));
  }

  /** Mine `blocks` blocks, each packing whatever the tx-pool holds. Returns the new tip. */
  async mine(blocks = 1): Promise<bigint> {
    for (let i = 0; i < blocks; i++) await this.call<string>("generate_block");
    return this.tip();
  }

  /** Jump `epochs` epochs ahead, for anything gated on an epoch (a force-close delay). */
  async advanceEpochs(epochs: number): Promise<bigint> {
    await this.call<string>("generate_epochs", [`0x${epochs.toString(16)}`]);
    return this.tip();
  }

  /** Block until the indexer has caught up with the tip. Blocks arrive far faster than the
   *  indexer's poll, and FNN picks funding cells through it: without this wait, the next funding
   *  tx is built from a cell the previous one already spent. */
  async syncIndexer(timeoutMs = this.#timeoutMs): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const tip = await this.tip();
    while (true) {
      const indexed = await this.call<{ block_number: string } | null>("get_indexer_tip");
      if (indexed !== null && BigInt(indexed.block_number) >= tip) return;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for the CKB indexer to reach block ${tip}`);
      await sleep(this.#blockIntervalMs);
    }
  }

  /** Keep mining until `probe` returns a value, then wait for the indexer. */
  async mineUntil<T>(probe: () => Promise<T | null | undefined>, options: MineUntilOptions): Promise<T> {
    const deadline = Date.now() + options.timeoutMs;
    let nextProbeAt = 0;
    while (true) {
      if (Date.now() >= nextProbeAt) {
        const value = await probe();
        if (value !== null && value !== undefined) {
          await this.syncIndexer();
          return value;
        }
        nextProbeAt = Date.now() + options.probeIntervalMs;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out after ${options.timeoutMs}ms waiting for ${options.label}`);
      }
      await this.call<string>("generate_block");
      await sleep(this.#blockIntervalMs);
    }
  }

  /** Mine until a transaction is committed. */
  async waitForCommit(txHash: string, timeoutMs: number, probeIntervalMs: number): Promise<void> {
    await this.mineUntil(
      async () => {
        const res = await this.call<{ tx_status: { status: string } } | null>("get_transaction", [txHash]);
        return res?.tx_status.status === "committed" ? true : null;
      },
      { label: `transaction ${txHash.slice(0, 12)}… to commit`, timeoutMs, probeIntervalMs },
    );
  }

  /** What a lock owns on-chain, in shannon. Syncs the indexer first so the answer is current. */
  async capacityOf(lock: LockScript): Promise<bigint> {
    await this.syncIndexer();
    const res = await this.call<{ capacity: string } | null>("get_cells_capacity", [
      { script: lock, script_type: "lock" },
    ]);
    return res === null ? 0n : BigInt(res.capacity);
  }

  async genesis(): Promise<GenesisFacts> {
    return parseGenesis(await this.call<GenesisBlock>("get_block_by_number", ["0x0"]));
  }
}
