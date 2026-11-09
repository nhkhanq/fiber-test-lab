import { ccc } from "@ckb-ccc/core";
import type { CkbChain, GenesisFacts } from "../ckb/chain";

const SECP256K1_CODE_HASH = "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8";

export interface UdtScript {
  code_hash: string;
  hash_type: "data";
  args: string;
}

function devnetClient(ckbEndpoint: string, genesis: GenesisFacts): ccc.ClientPublicTestnet {
  const base = new ccc.ClientPublicTestnet({ url: ckbEndpoint });
  return new ccc.ClientPublicTestnet({
    url: ckbEndpoint,
    scripts: {
      ...base.scripts,
      [ccc.KnownScript.Secp256k1Blake160]: {
        codeHash: SECP256K1_CODE_HASH,
        hashType: "type",
        cellDeps: [
          {
            cellDep: {
              outPoint: { txHash: genesis.secp256k1DepGroup.txHash, index: genesis.secp256k1DepGroup.index },
              depType: "depGroup",
            },
          },
        ],
      },
    },
  });
}

function hex(key: string): string {
  return key.startsWith("0x") ? key : `0x${key}`;
}

export interface MintResult {
  script: UdtScript;
  txHash: string;
}

export async function mintUdt(params: {
  chain: CkbChain;
  genesis: GenesisFacts;
  minterPrivKey: string;
  amount: bigint;
  timeoutMs: number;
  probeIntervalMs: number;
}): Promise<MintResult> {
  const { chain, genesis, minterPrivKey, amount, timeoutMs, probeIntervalMs } = params;
  const { simpleUdt } = genesis;
  await chain.syncIndexer();

  const client = devnetClient(chain.endpoint, genesis);
  const signer = new ccc.SignerCkbPrivateKey(client, hex(minterPrivKey));
  const { script: lock } = await signer.getRecommendedAddressObj();
  const ownerLockHash = lock.hash();
  const type = ccc.Script.from({ codeHash: simpleUdt.codeHash, hashType: "data", args: ownerLockHash });

  const tx = ccc.Transaction.from({
    outputs: [{ lock, type, capacity: ccc.fixedPointFrom(300) }],
    outputsData: [ccc.numLeToBytes(amount, 16)],
  });
  tx.cellDeps.push(
    ccc.CellDep.from({ outPoint: { txHash: simpleUdt.txHash, index: simpleUdt.index }, depType: "code" }),
  );
  await tx.completeInputsByCapacity(signer);
  await tx.addCellDepsOfKnownScripts(client, ccc.KnownScript.Secp256k1Blake160);
  await tx.completeFeeBy(signer, 1000n);

  const signed = await signer.signTransaction(tx);
  const txHash = await client.sendTransaction(signed, "passthrough");
  await chain.waitForCommit(txHash, timeoutMs, probeIntervalMs);

  return { script: { code_hash: simpleUdt.codeHash, hash_type: "data", args: ownerLockHash }, txHash };
}
