export interface ReleaseInfo {
  version: string;
  fnn: string;
  distTag: "latest" | "next";
}

const STABLE = /^\d+\.\d+\.\d+$/;

/**
 * Every release pins one FNN release. A stable package pins a stable FNN and goes to `latest`. A
 * release candidate `x.y.z-rc.N` pins FNN's `-rcN` and goes to `next`; a fix to it alone adds a
 * number, as in `-rc.N.1`.
 */
export function releaseInfo(version: string, fnn: string, tag?: string): ReleaseInfo {
  if (tag !== undefined && tag !== `v${version}`) {
    throw new Error(`Tag ${tag} does not name package version ${version}; expected v${version}.`);
  }
  if (STABLE.test(version) && STABLE.test(fnn)) return { version, fnn, distTag: "latest" };

  const candidate = /^\d+\.\d+\.\d+-rc\.(\d+)(?:\.\d+)?$/.exec(version)?.[1];
  if (candidate !== undefined && fnn.endsWith(`-rc${candidate}`)) return { version, fnn, distTag: "next" };

  throw new Error(`Package version ${version} does not fit the pinned FNN ${fnn}.`);
}
