import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import rawConfig from "../fiber-lab.config";
import { EXIT_CODES } from "./constants";
import { CliError } from "./errors";

export const GlobalConfigSchema = z.object({
  pollIntervalMs: z.number().int().positive().default(1000),
  pollTimeoutMs: z.number().int().positive().default(60_000),
  /** How often the lab mines a block while it is waiting for something on-chain. */
  blockIntervalMs: z.number().int().positive().default(200),
  dockerNetworkPrefix: z.string().min(1).default("flab"),
  /** The FNN release to run; also selects the on-chain contracts baked into the genesis. */
  fnnVersion: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/, "must be a bare version, e.g. 0.9.1 or 0.10.0-rc1"),
  /** When set, images are pulled from here before falling back to a local build. */
  imageRegistry: z.string().min(1).optional(),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  keepRunOnFailure: z.boolean().default(false),
  maxNodesPerScenario: z.number().int().positive().default(3),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

/** A project's own settings, read from its working directory. JSON so a codebase in any language
 *  can have one. */
export const PROJECT_CONFIG_FILE = "fiber-lab.config.json";

function readProjectConfig(cwd: string): Record<string, unknown> {
  const path = join(cwd, PROJECT_CONFIG_FILE);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    throw new CliError(`${PROJECT_CONFIG_FILE}: ${(error as Error).message}`, EXIT_CODES.validation);
  }
}

const ENV_NUMBERS: Record<string, keyof GlobalConfig> = {
  FIBER_LAB_POLL_INTERVAL_MS: "pollIntervalMs",
  FIBER_LAB_POLL_TIMEOUT_MS: "pollTimeoutMs",
  FIBER_LAB_BLOCK_INTERVAL_MS: "blockIntervalMs",
  FIBER_LAB_MAX_NODES: "maxNodesPerScenario",
};

function readEnvironment(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const fromEnv: Record<string, unknown> = {};
  if (env.FIBER_LAB_FNN_VERSION) fromEnv.fnnVersion = env.FIBER_LAB_FNN_VERSION;
  if (env.FIBER_LAB_IMAGE_REGISTRY) fromEnv.imageRegistry = env.FIBER_LAB_IMAGE_REGISTRY;
  for (const [name, key] of Object.entries(ENV_NUMBERS)) {
    if (env[name]) fromEnv[key] = Number(env[name]);
  }
  return fromEnv;
}

/** Lowest to highest precedence: the shipped defaults, the project's file, the environment (so CI
 *  can run a version matrix without editing anything), then anything passed in code. */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
  overrides: Partial<GlobalConfig> = {},
): GlobalConfig {
  const result = GlobalConfigSchema.strict().safeParse({
    ...rawConfig,
    ...readProjectConfig(cwd),
    ...readEnvironment(env),
    ...overrides,
  });
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
  throw new CliError(`Invalid configuration:\n${issues}`, EXIT_CODES.validation);
}
