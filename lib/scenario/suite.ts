import type { GlobalConfig } from "../config";
import { EXIT_CODES, type ExitCode } from "../constants";
import { reset } from "../docker/orchestrator";
import { CliError, RunFailedError } from "../errors";
import { writeRunReport } from "../report/write";
import { RunLogStore } from "../runlog/store";
import { checkScenarioLimits, loadAllScenarios, loadScenario } from "./loader";
import { runScenario } from "./run";
import type { Scenario } from "./schema";
import { describeMismatch } from "./verify";

export interface SuiteSelection {
  names: string[];
  all?: boolean;
  tags?: string[];
}

export type CaseStatus = "passed" | "failed" | "error";

export interface SuiteCase {
  scenario: string;
  status: CaseStatus;
  runId: string | null;
  durationMs: number;
  messages: string[];
  report?: string;
}

export interface SuiteResult {
  cases: SuiteCase[];
  durationMs: number;
  passed: number;
  failed: number;
  errors: number;
}

export interface SuiteOptions {
  keep?: boolean;
  html?: boolean;
  onStart?: (scenario: string) => void;
  onResult?: (result: SuiteCase) => void;
}

/** Resolve a selection and validate all of it, so a typo in the last scenario fails in a second
 *  instead of after everything before it has run. */
export async function selectScenarios(selection: SuiteSelection, config: GlobalConfig): Promise<Scenario[]> {
  const { names, all, tags = [] } = selection;
  if (names.length === 0 && !all && tags.length === 0) {
    throw new CliError("Nothing selected: name one or more scenarios, or pass --all or --tag.", EXIT_CODES.validation);
  }

  const named = await Promise.all(names.map((name) => loadScenario(name)));
  const builtin = all || tags.length > 0 ? await loadAllScenarios() : [];
  const tagged = all ? builtin : builtin.filter((s) => s.tags.some((t) => tags.includes(t)));

  const selected = new Map<string, Scenario>();
  for (const scenario of [...named, ...tagged]) selected.set(scenario.name, scenario);
  if (selected.size === 0) {
    throw new CliError(`No scenario carries any of these tags: ${tags.join(", ")}.`, EXIT_CODES.validation);
  }

  const scenarios = [...selected.values()];
  for (const scenario of scenarios) checkScenarioLimits(scenario, config);
  return scenarios;
}

async function runCase(scenario: Scenario, config: GlobalConfig, options: SuiteOptions): Promise<SuiteCase> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  try {
    const { up, expectation } = await runScenario(scenario, config, { keep: options.keep });
    const passed = expectation?.match === true;
    if (passed || !options.keep) await reset(up.runId, config);
    return {
      scenario: scenario.name,
      status: passed ? "passed" : "failed",
      runId: up.runId,
      durationMs: elapsed(),
      messages: expectation === null ? ["nothing was checked"] : describeMismatch(expectation),
    };
  } catch (error) {
    return {
      scenario: scenario.name,
      status: "error",
      runId: error instanceof RunFailedError ? error.runId : null,
      durationMs: elapsed(),
      messages: [error instanceof Error ? error.message : String(error)],
    };
  }
}

/** One scenario at a time: each is a full cluster, and timing-sensitive steps should not compete
 *  for the same CPU. */
export async function runSuite(scenarios: Scenario[], config: GlobalConfig, options: SuiteOptions = {}): Promise<SuiteResult> {
  const started = Date.now();
  const cases: SuiteCase[] = [];
  for (const scenario of scenarios) {
    options.onStart?.(scenario.name);
    const result = await runCase(scenario, config, options);
    if (options.html && result.runId !== null) {
      result.report = await writeRunReport(await RunLogStore.load(result.runId));
    }
    cases.push(result);
    options.onResult?.(result);
  }
  const count = (status: CaseStatus) => cases.filter((c) => c.status === status).length;
  return {
    cases,
    durationMs: Date.now() - started,
    passed: count("passed"),
    failed: count("failed"),
    errors: count("error"),
  };
}

/** A broken environment outranks a wrong result: it means the results cannot be trusted. */
export function suiteExitCode(result: SuiteResult): ExitCode {
  if (result.errors > 0) return EXIT_CODES.runtime;
  if (result.failed > 0) return EXIT_CODES.expectation;
  return EXIT_CODES.ok;
}

function xml(text: string): string {
  return text
    // Characters XML 1.0 cannot represent at all, even escaped.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const seconds = (ms: number) => (ms / 1000).toFixed(3);

export function renderJUnit(result: SuiteResult): string {
  const totals = `tests="${result.cases.length}" failures="${result.failed}" errors="${result.errors}" time="${seconds(result.durationMs)}"`;
  const testcases = result.cases.map((c) => {
    const body = xml(c.messages.join("\n"));
    const summary = xml(c.messages[0] ?? "");
    const verdict =
      c.status === "failed"
        ? `      <failure message="${summary}">${body}</failure>\n`
        : c.status === "error"
          ? `      <error message="${summary}">${body}</error>\n`
          : "";
    const out = c.runId === null ? "" : `      <system-out>run-id: ${xml(c.runId)}</system-out>\n`;
    return `    <testcase classname="fiber-lab" name="${xml(c.scenario)}" time="${seconds(c.durationMs)}">\n${verdict}${out}    </testcase>`;
  });
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<testsuites name="fiber-lab" ${totals}>`,
    `  <testsuite name="fiber-lab" ${totals}>`,
    ...testcases,
    `  </testsuite>`,
    `</testsuites>`,
    ``,
  ].join("\n");
}
