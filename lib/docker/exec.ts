import { spawn } from "node:child_process";

export class DockerError extends Error {
  constructor(message: string, readonly stderr = "") {
    super(message);
    this.name = "DockerError";
  }
}

export interface DockerResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Called with each complete line docker prints, as it prints it. */
export type LineHandler = (line: string) => void;

export function docker(args: string[], onLine?: LineHandler): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { cwd: process.cwd() });
    let stdout = "";
    let stderr = "";

    const streamLines = (): ((chunk: string) => void) => {
      let partial = "";
      return (chunk: string) => {
        partial += chunk;
        const lines = partial.split("\n");
        partial = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.length > 0) onLine?.(trimmed);
        }
      };
    };
    const onOut = streamLines();
    const onErr = streamLines();

    child.stdout.on("data", (d) => {
      const text = d.toString();
      stdout += text;
      if (onLine) onOut(text);
    });
    child.stderr.on("data", (d) => {
      const text = d.toString();
      stderr += text;
      if (onLine) onErr(text);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}
