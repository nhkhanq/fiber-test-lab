import { describe, expect, it } from "vitest";
import { ckbToShannon, formatBaseUnits, isRepresentableAmount, toBaseUnits, toHex } from "../../lib/fiber/amounts";

describe("amounts", () => {
  it("converts decimal CKB to shannon exactly", () => {
    expect(ckbToShannon(100)).toBe(10_000_000_000n);
    expect(ckbToShannon(0.1)).toBe(10_000_000n);
    expect(ckbToShannon(100.1)).toBe(10_010_000_000n);
    expect(ckbToShannon(0.00000001)).toBe(1n);
  });

  it("keeps the sign of a fractional delta", () => {
    expect(ckbToShannon(-0.5)).toBe(-50_000_000n);
    expect(ckbToShannon(-100.1)).toBe(-10_010_000_000n);
  });

  it("rejects amounts finer than a shannon", () => {
    expect(isRepresentableAmount(0.123456789, "CKB")).toBe(false);
    expect(() => ckbToShannon(0.123456789)).toThrow(RangeError);
  });

  it("requires whole base units for a UDT and does not scale them", () => {
    expect(isRepresentableAmount(0.5, "RUSD")).toBe(false);
    expect(isRepresentableAmount(100, "RUSD")).toBe(true);
    expect(toBaseUnits(100, "RUSD")).toBe(100n);
    expect(() => toBaseUnits(0.5, "RUSD")).toThrow(RangeError);
  });

  it("rejects values that are not finite numbers", () => {
    expect(isRepresentableAmount(Number.NaN, "CKB")).toBe(false);
    expect(isRepresentableAmount(Number.POSITIVE_INFINITY, "CKB")).toBe(false);
  });

  it("hex-encodes base units and refuses a negative", () => {
    expect(toHex(255n)).toBe("0xff");
    expect(() => toHex(-1n)).toThrow(RangeError);
  });

  it("formats base units for people", () => {
    expect(formatBaseUnits(30_100_000_000n, "CKB")).toBe("301 CKB");
    expect(formatBaseUnits(10_000_000n, "CKB")).toBe("0.1 CKB");
    expect(formatBaseUnits(-10_010_000_000n, "CKB")).toBe("-100.1 CKB");
    expect(formatBaseUnits(250n, "RUSD")).toBe("250 RUSD");
  });
});
