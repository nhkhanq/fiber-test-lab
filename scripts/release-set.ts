// Sets the package version and the FNN it pins in one step, so neither can be forgotten.
// usage: npm run release:set -- <package-version> <fnn-version>
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { releaseInfo } from "../lib/release";

const [version, fnn] = process.argv.slice(2);

try {
  if (version === undefined || fnn === undefined) {
    throw new Error("usage: npm run release:set -- <package-version> <fnn-version>");
  }
  releaseInfo(version, fnn);

  const config = "fiber-lab.config.ts";
  writeFileSync(config, readFileSync(config, "utf8").replace(/fnnVersion: "[^"]*"/, `fnnVersion: "${fnn}"`));
  execSync(`npm version ${version} --no-git-tag-version --allow-same-version`, { stdio: "inherit" });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
