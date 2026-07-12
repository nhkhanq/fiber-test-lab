import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { SCENARIOS_DIR } from "../constants";
import { ScenarioSchema, type Scenario } from "./schema";

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

  const result = ScenarioSchema.safeParse(parsed);
  if (!result.success) {
    throw new ScenarioValidationError(
      filePath,
      result.error.issues.map((i) => ({
        path: i.path.join(".") || "(root)",
        message: i.message,
      })),
    );
  }

  const scenario = result.data;
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

export interface ScenarioSummary {
  name: string;
  description: string;
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
      summaries.push({ name, description: scenario.description, valid: true });
    } catch (error) {
      summaries.push({
        name,
        description: "",
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return summaries;
}
