import { EXIT_CODES, type ExitCode } from "./constants";
import { DockerError } from "./docker/exec";
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

export class RunFailedError extends CliError {
  constructor(message: string, readonly runId: string) {
    super(message, EXIT_CODES.runtime);
    this.name = "RunFailedError";
  }
}

export function exitCodeFor(error: unknown): ExitCode {
  if (error instanceof CliError) return error.exitCode;
  if (error instanceof ScenarioValidationError) return EXIT_CODES.validation;
  if (error instanceof DockerError) return EXIT_CODES.runtime;
  return EXIT_CODES.runtime;
}
