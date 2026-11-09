import { z } from "zod";
import rawConfig from "../fiber-lab.config";

export const GlobalConfigSchema = z.object({
  pollIntervalMs: z.number().int().positive().default(1000),
  pollTimeoutMs: z.number().int().positive().default(60_000),
  blockIntervalMs: z.number().int().positive().default(200),
  dockerNetworkPrefix: z.string().min(1).default("flab"),
  fnnVersion: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/, "must be a bare version, e.g. 0.9.1 or 0.10.0-rc1"),
  imageRegistry: z.string().min(1).optional(),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  keepRunOnFailure: z.boolean().default(false),
  maxNodesPerScenario: z.number().int().positive().default(3),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GlobalConfig {
  return GlobalConfigSchema.parse({
    ...rawConfig,
    ...(env.FIBER_LAB_FNN_VERSION ? { fnnVersion: env.FIBER_LAB_FNN_VERSION } : {}),
    ...(env.FIBER_LAB_IMAGE_REGISTRY ? { imageRegistry: env.FIBER_LAB_IMAGE_REGISTRY } : {}),
  });
}
