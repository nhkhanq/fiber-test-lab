// Runs with the tag in the release workflow, and with no argument before any `npm publish`, so a
// number that does not match the pinned FNN cannot reach npm from CI or from a laptop.
import config from "../fiber-lab.config";
import { releaseInfo } from "../lib/release";
import pkg from "../package.json" with { type: "json" };

try {
  const info = releaseInfo(pkg.version, config.fnnVersion, process.argv[2]);
  const distTag = process.env.npm_config_tag ?? "latest";
  if (process.env.npm_lifecycle_event === "prepublishOnly" && distTag !== info.distTag) {
    throw new Error(`${info.version} must be published with --tag ${info.distTag}, not ${distTag}.`);
  }
  console.log(`version=${info.version}`);
  console.log(`fnn=${info.fnn}`);
  console.log(`dist_tag=${info.distTag}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
