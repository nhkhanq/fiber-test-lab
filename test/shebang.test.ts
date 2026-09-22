import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGE_ROOT } from "../lib/constants";

/** Regression guard for commit 0911d15, an automated comment-stripping pass that read `#!` as a
 *  comment and deleted it from all three executables at once. The damage is invisible until
 *  something execs them: the CKB and FNN containers died with "exec format error", which surfaced
 *  as `dependency failed to start: container ... is unhealthy`, and `cli/index.ts` is the `bin`
 *  entry, so an installed `fiber-lab` broke the same way. */

const EXECUTABLES: Record<string, string> = {
  "topology/docker/ckb/entrypoint.sh": "#!/usr/bin/env bash",
  "topology/docker/fnn/entrypoint.sh": "#!/usr/bin/env bash",
  "cli/index.ts": "#!/usr/bin/env -S npx tsx",
};

describe("executables keep their shebang", () => {
  for (const [path, shebang] of Object.entries(EXECUTABLES)) {
    it(path, async () => {
      const contents = await readFile(join(PACKAGE_ROOT, path), "utf8");
      expect(contents.split("\n")[0]).toBe(shebang);
    });
  }
});
