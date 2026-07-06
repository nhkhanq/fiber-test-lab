import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
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
      `Scenario không hợp lệ (${file}):\n` +
        issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n"),
    );
    this.name = "ScenarioValidationError";
  }
}

export function scenarioPath(name: string): string {
  return join(SCENARIOS_DIR, `${name}.yaml`);
}

export async function loadScenarioFile(filePath: string): Promise<Scenario> {
  const raw = await readFile(filePath, "utf8");

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
      { path: "name", message: `name "${scenario.name}" không khớp tên file "${expected}"` },
    ]);
  }

  return scenario;
}

export function loadScenarioByName(name: string): Promise<Scenario> {
  return loadScenarioFile(scenarioPath(name));
}
