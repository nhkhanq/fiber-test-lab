export interface ReleaseInfo {
  version: string;
  fnn: string;
  distTag: "latest" | "next";
}

function parseVersion(version: string): { line: string; patch: number; suffix: string | undefined } {
  const match = /^(\d+\.\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$/.exec(version);
  if (match === null) throw new Error(`"${version}" is not a release version`);
  return { line: match[1] as string, patch: Number(match[2]), suffix: match[3] };
}

/**
 * The package is numbered after the FNN release it pins, the way @nervosnetwork/fiber-js is. A fix to
 * the lab alone still needs a number of its own, because npm never reuses one: it takes the next patch
 * on a stable line, and a `.N` suffix on a release candidate.
 */
export function releaseInfo(version: string, fnn: string, tag?: string): ReleaseInfo {
  if (tag !== undefined && tag !== `v${version}`) {
    throw new Error(`Tag ${tag} does not name package version ${version}; expected v${version}.`);
  }
  const lab = parseVersion(version);
  const pinned = parseVersion(fnn);
  const mismatch = new Error(`Package version ${version} does not follow the pinned FNN ${fnn}.`);

  if (lab.line !== pinned.line) throw mismatch;
  if (pinned.suffix === undefined) {
    if (lab.suffix !== undefined || lab.patch < pinned.patch) throw mismatch;
  } else {
    const sameCandidate = lab.suffix === pinned.suffix || lab.suffix?.startsWith(`${pinned.suffix}.`);
    if (lab.patch !== pinned.patch || !sameCandidate) throw mismatch;
  }
  return { version, fnn, distTag: lab.suffix === undefined ? "latest" : "next" };
}
