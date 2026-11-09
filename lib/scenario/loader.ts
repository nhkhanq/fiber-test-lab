import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { GlobalConfig } from "../config";
import { CKB_SERVICE, DEV_FUNDED_KEYS, SCENARIOS_DIR } from "../constants";
import { ScenarioSchema, type Scenario, type ScenarioInput } from "./schema";

export interface ScenarioIssue {
  path: string;
  message: string;
}

export class ScenarioValidationError extends Error {
  constructor(
    readonly file: string,
    readonly issues: ScenarioIssue[],
  ) {
    super(
      `Invalid scenario (${file}):\n` +
        issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n"),
    );
    this.name = "ScenarioValidationError";
  }
}

export function scenarioPath(name: string): string {
  return join(SCENARIOS_DIR, `${name}.yaml`);
}

export function parseScenario(input: unknown, source = "(inline scenario)"): Scenario {
  const result = ScenarioSchema.safeParse(input);
  if (result.success) return result.data;
  throw new ScenarioValidationError(
    source,
    result.error.issues.map((i) => ({
      path: i.path.join(".") || "(root)",
      message: i.message,
    })),
  );
}

export function resolveScenario(input: string | ScenarioInput): Promise<Scenario> {
  return typeof input === "string" ? loadScenario(input) : Promise.resolve(parseScenario(input));
}

export function checkScenarioLimits(scenario: Scenario, config: GlobalConfig): void {
  const issues: ScenarioIssue[] = [];
  if (scenario.nodes.length > config.maxNodesPerScenario) {
    issues.push({
      path: "nodes",
      message: `${scenario.nodes.length} nodes is over maxNodesPerScenario=${config.maxNodesPerScenario} (fiber-lab.config.ts)`,
    });
  }
  if (scenario.nodes.length > DEV_FUNDED_KEYS.length) {
    issues.push({
      path: "nodes",
      message: `${scenario.nodes.length} nodes, but only ${DEV_FUNDED_KEYS.length} accounts are funded in genesis`,
    });
  }
  if (scenario.nodes.includes(CKB_SERVICE)) {
    issues.push({ path: "nodes", message: `node name "${CKB_SERVICE}" collides with the CKB devnet service` });
  }
  if (issues.length > 0) throw new ScenarioValidationError(scenario.name, issues);
}

export async function loadScenarioFile(filePath: string): Promise<Scenario> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ScenarioValidationError(filePath, [
        { path: "(file)", message: `Scenario file "${filePath}" not found` },
      ]);
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    throw new ScenarioValidationError(filePath, [
      { path: "(yaml)", message: error instanceof Error ? error.message : String(error) },
    ]);
  }

  const scenario = parseScenario(parsed, filePath);
  const expected = basename(filePath).replace(/\.ya?ml$/i, "");
  if (scenario.name !== expected) {
    throw new ScenarioValidationError(filePath, [
      { path: "name", message: `name "${scenario.name}" does not match file name "${expected}"` },
    ]);
  }

  return scenario;
}

export function loadScenarioByName(name: string): Promise<Scenario> {
  return loadScenarioFile(scenarioPath(name));
}

export function loadScenario(nameOrPath: string): Promise<Scenario> {
  const isPath = /\.ya?ml$/i.test(nameOrPath) || nameOrPath.includes("/") || nameOrPath.includes("\\");
  return loadScenarioFile(isPath ? resolve(nameOrPath) : scenarioPath(nameOrPath));
}

/** Every built-in scenario, loaded strictly: one invalid file fails the whole selection. */
export async function loadAllScenarios(): Promise<Scenario[]> {
  const files = await readdir(SCENARIOS_DIR).catch(() => [] as string[]);
  return Promise.all(files.filter((f) => /.ya?ml$/i.test(f)).sort().map((f) => loadScenarioFile(join(SCENARIOS_DIR, f))));
}

export interface ScenarioSummary {
  name: string;
  description: string;
  tags: string[];
  valid: boolean;
  error?: string;
}

export async function listScenarios(): Promise<ScenarioSummary[]> {
  const files = await readdir(SCENARIOS_DIR).catch(() => [] as string[]);
  const summaries: ScenarioSummary[] = [];
  for (const file of files.filter((f) => /\.ya?ml$/i.test(f)).sort()) {
    const name = file.replace(/\.ya?ml$/i, "");
    try {
      const scenario = await loadScenarioFile(join(SCENARIOS_DIR, file));
      summaries.push({ name, description: scenario.description, tags: scenario.tags, valid: true });
    } catch (error) {
      summaries.push({
        name,
        description: "",
        tags: [],
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return summaries;
}
