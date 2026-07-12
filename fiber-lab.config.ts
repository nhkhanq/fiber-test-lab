import type { GlobalConfig } from "./lib/config";

const config: GlobalConfig = {
  pollIntervalMs: 1000,
  pollTimeoutMs: 60_000,
  dockerNetworkPrefix: "flab",
  fnnVersion: "0.8.0", 
  logLevel: "info",
  keepRunOnFailure: false,
  maxNodesPerScenario: 3,
};

export default config;
