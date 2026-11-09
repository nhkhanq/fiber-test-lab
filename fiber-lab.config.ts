import type { GlobalConfig } from "./lib/config";

const config: GlobalConfig = {
  pollIntervalMs: 1000,
  pollTimeoutMs: 60_000,
  blockIntervalMs: 200,
  dockerNetworkPrefix: "flab",
  fnnVersion: "0.9.1",
  logLevel: "info",
  keepRunOnFailure: false,
  maxNodesPerScenario: 5,
};

export default config;
