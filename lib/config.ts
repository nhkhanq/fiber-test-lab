import { z } from "zod";
import rawConfig from "../fiber-lab.config";

export const GlobalConfigSchema = z.object({
  pollIntervalMs: z.number().int().positive().default(1000),
  pollTimeoutMs: z.number().int().positive().default(30_000),
  dockerNetworkPrefix: z.string().min(1).default("flab"),
  fnnVersion: z.string().min(1),
  /** Mức log. */
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  keepRunOnFailure: z.boolean().default(false),
  maxNodesPerScenario: z.number().int().positive().default(3),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

export function loadConfig(): GlobalConfig {
  return GlobalConfigSchema.parse(rawConfig);
}
