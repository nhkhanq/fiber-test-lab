import { EXIT_CODES, type ExitCode } from "./constants";
import { DockerError } from "./docker/orchestrator";
import { ScenarioValidationError } from "./scenario/loader";

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode = EXIT_CODES.runtime,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export function exitCodeFor(error: unknown): ExitCode {
  if (error instanceof CliError) return error.exitCode;
  if (error instanceof ScenarioValidationError) return EXIT_CODES.validation;
  if (error instanceof DockerError) return EXIT_CODES.runtime;
  return EXIT_CODES.runtime;
}
