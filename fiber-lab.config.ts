import type { GlobalConfig } from "./lib/config";

const config: GlobalConfig = {
  pollIntervalMs: 1000,
  // ChannelReady trên CKB devnet thường mất ~36-40s để confirm (xem E3-6/E3-7 progress notes) — 30s hay timeout giả.
  pollTimeoutMs: 60_000,
  dockerNetworkPrefix: "flab",
  fnnVersion: "0.8.0", 
  logLevel: "info",
  keepRunOnFailure: false,
  maxNodesPerScenario: 3,
};

export default config;
