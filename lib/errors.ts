import { EXIT_CODES, type ExitCode } from "./constants";
import { DockerError } from "./docker/orchestrator";
import { ScenarioValidationError } from "./scenario/loader";

/** Lỗi CLI có exit code gắn sẵn — command throw cái này thay vì tự set process.exitCode. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode = EXIT_CODES.runtime,
  ) {
    super(message);
    this.name = "CliError";
  }
}

/** Map mọi lỗi → exit code chuẩn (cli-spec). Validation → 1, docker/RPC → 2, mặc định 2. */
export function exitCodeFor(error: unknown): ExitCode {
  if (error instanceof CliError) return error.exitCode;
  if (error instanceof ScenarioValidationError) return EXIT_CODES.validation;
  if (error instanceof DockerError) return EXIT_CODES.runtime;
  return EXIT_CODES.runtime;
}
