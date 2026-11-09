import { describe, expect, it } from "vitest";
import config from "../../fiber-lab.config";
import { releaseInfo } from "../../lib/release";
import pkg from "../../package.json" with { type: "json" };

describe("releaseInfo", () => {
  it("sends a stable package pinning a stable FNN to latest", () => {
    expect(releaseInfo("1.2.0", "0.9.1", "v1.2.0")).toEqual({ version: "1.2.0", fnn: "0.9.1", distTag: "latest" });
  });

  it("sends a release candidate pinning the same FNN candidate to next", () => {
    expect(releaseInfo("1.3.0-rc.2", "0.10.0-rc2").distTag).toBe("next");
  });

  it("allows a fix to a release candidate", () => {
    expect(releaseInfo("1.3.0-rc.2.1", "0.10.0-rc2").distTag).toBe("next");
  });

  it.each([
    ["1.3.0-rc.2", "0.9.1"],
    ["1.3.0-rc.1", "0.10.0-rc2"],
    ["1.3.0-rc.2", "0.10.0-rc12"],
    ["1.3.0", "0.10.0-rc2"],
    ["1.3.0-beta.1", "0.10.0-rc1"],
    ["latest", "0.9.1"],
  ])("rejects package %s pinning FNN %s", (version, fnn) => {
    expect(() => releaseInfo(version, fnn)).toThrow(/does not fit/);
  });

  it("rejects a tag that names another version", () => {
    expect(() => releaseInfo("1.2.0", "0.9.1", "v1.2.1")).toThrow(/expected v1\.2\.0/);
  });

  it("holds for this repository's own version and pin", () => {
    expect(() => releaseInfo(pkg.version, config.fnnVersion)).not.toThrow();
  });
});
