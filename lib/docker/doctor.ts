import { docker, DockerError } from "./exec";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

const MINIMUM_NODE = [20, 6] as const;

function checkNode(version: string = process.versions.node): DoctorCheck {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  const ok = major > MINIMUM_NODE[0] || (major === MINIMUM_NODE[0] && minor >= MINIMUM_NODE[1]);
  return { name: "node", ok, detail: ok ? version : `${version} — needs ${MINIMUM_NODE.join(".")} or later` };
}

async function firstLine(args: string[]): Promise<{ ok: boolean; line: string }> {
  try {
    const r = await docker(args);
    const text = (r.code === 0 ? r.stdout : r.stderr || r.stdout).trim();
    return { ok: r.code === 0, line: text.split("\n").at(-1) ?? "" };
  } catch (error) {
    return { ok: false, line: (error as Error).message };
  }
}

export async function runDoctor(fnnVersion: string): Promise<DoctorCheck[]> {
  const daemon = await firstLine(["version", "--format", "{{.Server.Version}} {{.Server.Os}}/{{.Server.Arch}}"]);
  const compose = await firstLine(["compose", "version", "--short"]);
  return [
    checkNode(),
    { name: "docker", ok: daemon.ok, detail: daemon.ok ? daemon.line : `not reachable: ${daemon.line}` },
    { name: "docker compose", ok: compose.ok, detail: compose.ok ? compose.line : `not available: ${compose.line}` },
    { name: "fnn", ok: true, detail: fnnVersion },
  ];
}

/** Fail with something actionable before the first docker command prints something that is not. */
export async function assertDockerReady(): Promise<void> {
  const daemon = await firstLine(["version", "--format", "{{.Server.Version}}"]);
  if (!daemon.ok) {
    throw new DockerError(`Docker is not available (${daemon.line}). Start Docker, then retry; \`fiber-lab doctor\` shows what is missing.`);
  }
}

export { checkNode };
