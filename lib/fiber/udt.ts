import { ccc } from "@ckb-ccc/core";
import { SECP256K1_DEP_GROUP, SIMPLE_UDT_CODE_HASH, SIMPLE_UDT_DEP } from "../constants";

const SECP256K1_CODE_HASH = "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8";

export interface UdtScript {
  code_hash: string;
  hash_type: "data";
  args: string;
}

/** Client CCC trỏ vào CKB devnet của run, override secp256k1 dep_group (mặc định của CCC là testnet — sai). */
function devnetClient(ckbEndpoint: string): ccc.ClientPublicTestnet {
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
              outPoint: { txHash: SECP256K1_DEP_GROUP.txHash, index: SECP256K1_DEP_GROUP.index },
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

/**
 * Mint `amount` đơn vị sUDT cho chủ của `minterPrivKey` (owner = lock hash của key đó) và chờ tx commit.
 * Trả về type script sUDT (JSON cho FNN `funding_udt_type_script`). Xem E8-4 / rpc-notebook §11.
 */
export async function mintUdt(ckbEndpoint: string, minterPrivKey: string, amount: bigint): Promise<UdtScript> {
  const client = devnetClient(ckbEndpoint);
  const signer = new ccc.SignerCkbPrivateKey(client, hex(minterPrivKey));
  const { script: lock } = await signer.getRecommendedAddressObj();
  const ownerLockHash = lock.hash();
  const type = ccc.Script.from({ codeHash: SIMPLE_UDT_CODE_HASH, hashType: "data", args: ownerLockHash });

  const tx = ccc.Transaction.from({
    outputs: [{ lock, type, capacity: ccc.fixedPointFrom(300) }],
    outputsData: [ccc.numLeToBytes(amount, 16)],
  });
  tx.cellDeps.push(
    ccc.CellDep.from({ outPoint: { txHash: SIMPLE_UDT_DEP.txHash, index: SIMPLE_UDT_DEP.index }, depType: "code" }),
  );
  await tx.completeInputsByCapacity(signer);
  await tx.addCellDepsOfKnownScripts(client, ccc.KnownScript.Secp256k1Blake160);
  await tx.completeFeeBy(signer, 1000n);

  const signed = await signer.signTransaction(tx);
  const hash = await client.sendTransaction(signed, "passthrough");
  await client.waitTransaction(hash);

  return { code_hash: SIMPLE_UDT_CODE_HASH, hash_type: "data", args: ownerLockHash };
}
