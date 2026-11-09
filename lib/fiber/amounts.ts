import { SHANNON_PER_CKB, UDT_ASSET } from "../constants";

const CKB_DECIMALS = 8;

function fixedCkb(value: number): string | null {
  const fixed = Math.abs(value).toFixed(CKB_DECIMALS);
  if (fixed.includes("e") || Number(fixed) !== Math.abs(value)) return null;
  return fixed;
}

export function isRepresentableAmount(value: number, asset: string): boolean {
  if (!Number.isFinite(value)) return false;
  if (asset === UDT_ASSET) return Number.isSafeInteger(value);
  return fixedCkb(value) !== null;
}

export function ckbToShannon(ckb: number): bigint {
  const fixed = fixedCkb(ckb);
  if (fixed === null) throw new RangeError(`${ckb} CKB is not representable in shannon (max ${CKB_DECIMALS} decimals)`);
  const [whole, fraction] = fixed.split(".") as [string, string];
  const shannon = BigInt(whole) * SHANNON_PER_CKB + BigInt(fraction);
  return ckb < 0 ? -shannon : shannon;
}

/** A scenario amount -> base units: shannon for CKB, the token's own unit for a UDT. */
export function toBaseUnits(value: number, asset: string): bigint {
  if (asset !== UDT_ASSET) return ckbToShannon(value);
  if (!Number.isSafeInteger(value)) throw new RangeError(`${value} ${asset} must be a whole number of base units`);
  return BigInt(value);
}

export function toHex(value: bigint): string {
  if (value < 0n) throw new RangeError(`cannot hex-encode a negative amount (${value})`);
  return `0x${value.toString(16)}`;
}

export function formatBaseUnits(value: bigint, asset: string): string {
  if (asset === UDT_ASSET) return `${value.toString()} ${asset}`;
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const whole = abs / SHANNON_PER_CKB;
  const fraction = abs % SHANNON_PER_CKB;
  if (fraction === 0n) return `${sign}${whole} CKB`;
  const decimals = fraction.toString().padStart(CKB_DECIMALS, "0").replace(/0+$/, "");
  return `${sign}${whole}.${decimals} CKB`;
}
