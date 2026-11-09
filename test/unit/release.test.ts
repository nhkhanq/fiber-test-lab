import { describe, expect, it } from "vitest";
import config from "../../fiber-lab.config";
import { releaseInfo } from "../../lib/release";
import pkg from "../../package.json" with { type: "json" };

describe("releaseInfo", () => {
  it("sends a stable FNN release to latest", () => {
    expect(releaseInfo("0.9.1", "0.9.1", "v0.9.1")).toEqual({ version: "0.9.1", fnn: "0.9.1", distTag: "latest" });
  });

  it("sends a release candidate to next", () => {
    expect(releaseInfo("0.10.0-rc2", "0.10.0-rc2").distTag).toBe("next");
  });

  it("gives a fix to the lab alone the next patch on the same line", () => {
    expect(releaseInfo("0.9.2", "0.9.1").distTag).toBe("latest");
  });

  it("gives a fix to the lab alone a numbered suffix on a release candidate", () => {
    expect(releaseInfo("0.10.0-rc2.1", "0.10.0-rc2").distTag).toBe("next");
  });

  it.each([
    ["0.10.0", "0.9.1"],
    ["0.9.0", "0.9.1"],
    ["0.10.0-rc1", "0.10.0-rc2"],
    ["0.10.0-rc23", "0.10.0-rc2"],
    ["0.10.0-rc2", "0.10.0"],
    ["0.10.0", "0.10.0-rc2"],
    ["0.10.1-rc2", "0.10.0-rc2"],
    ["0.9.2-rc1", "0.9.1"],
  ])("rejects package %s pinning FNN %s", (version, fnn) => {
    expect(() => releaseInfo(version, fnn)).toThrow(/does not follow/);
  });

  it("rejects something that is not a version", () => {
    expect(() => releaseInfo("latest", "0.9.1")).toThrow(/not a release version/);
  });

  it("rejects a tag that names another version", () => {
    expect(() => releaseInfo("0.9.1", "0.9.1", "v0.9.2")).toThrow(/expected v0\.9\.1/);
  });

  it("holds for this repository's own version and pin", () => {
    expect(() => releaseInfo(pkg.version, config.fnnVersion)).not.toThrow();
  });
});
