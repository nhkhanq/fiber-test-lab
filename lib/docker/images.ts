import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { GlobalConfig } from "../config";
import {
  CKB_DOCKERFILE,
  CKB_IMAGE_NAME,
  CKB_VERSION,
  DOCKER_BUILD_CONTEXT,
  FNN_DOCKERFILE,
  FNN_IMAGE_NAME,
} from "../constants";
import { docker, DockerError, type LineHandler } from "./exec";

export interface LabImages {
  fnn: string;
  ckb: string;
}

export interface EnsureImagesResult {
  images: LabImages;
  built: string[];
  pulled: string[];
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? listFiles(path) : Promise.resolve([path]);
    }),
  );
  return nested.flat().sort();
}

/** A digest of everything that goes into the images, so editing an entrypoint or the chain spec
 *  produces a new tag instead of silently reusing a stale image. Line endings are normalized:
 *  git may check these files out with CRLF on Windows, and that must not change the digest. */
export async function contextDigest(dir: string = DOCKER_BUILD_CONTEXT): Promise<string> {
  const hash = createHash("sha256");
  for (const file of await listFiles(dir)) {
    const contents = await readFile(file, "utf8");
    hash.update(relative(dir, file).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(contents.replaceAll("\r\n", "\n"));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}

export function imageTags(fnnVersion: string, digest: string): LabImages {
  return {
    fnn: `${FNN_IMAGE_NAME}:${fnnVersion}-${digest}`,
    ckb: `${CKB_IMAGE_NAME}:${CKB_VERSION}-fnn${fnnVersion}-${digest}`,
  };
}

/** BuildKit ends its output by echoing the Dockerfile, so the last lines never say what went wrong.
 *  The failing step's own output sits between the first pair of dashed rules. */
export function buildFailureCause(stderr: string): string {
  const lines = stderr.trim().split(/\r?\n/);
  const start = lines.indexOf("------");
  const end = start === -1 ? -1 : lines.indexOf("------", start + 1);
  const cause = end === -1 ? lines.slice(-12) : lines.slice(start + 1, end).slice(-10);
  return cause.map((line) => line.slice(0, 240)).join("\n");
}

async function imageExists(tag: string): Promise<boolean> {
  return (await docker(["image", "inspect", "--format", "{{.Id}}", tag])).code === 0;
}

async function pullImage(registry: string, tag: string, onLine?: LineHandler): Promise<boolean> {
  const remote = `${registry.replace(/\/+$/, "")}/${tag}`;
  if ((await docker(["pull", remote], onLine)).code !== 0) return false;
  return (await docker(["tag", remote, tag])).code === 0;
}

async function buildImage(tag: string, dockerfile: string, config: GlobalConfig, onLine?: LineHandler): Promise<void> {
  const result = await docker(
    [
      "build",
      "--progress=plain",
      "-t",
      tag,
      "-f",
      join(DOCKER_BUILD_CONTEXT, dockerfile),
      "--build-arg",
      `FNN_VERSION=${config.fnnVersion}`,
      "--build-arg",
      `CKB_VERSION=${CKB_VERSION}`,
      DOCKER_BUILD_CONTEXT,
    ],
    onLine,
  );
  if (result.code !== 0) throw new DockerError(`docker build failed for ${tag}:\n${buildFailureCause(result.stderr)}`, result.stderr);
}

/** Images are shared by every run of the same versions: built once, never per run. */
export async function ensureImages(config: GlobalConfig, onLine?: LineHandler): Promise<EnsureImagesResult> {
  const images = imageTags(config.fnnVersion, await contextDigest());
  const built: string[] = [];
  const pulled: string[] = [];

  const targets: [string, string][] = [
    [images.ckb, CKB_DOCKERFILE],
    [images.fnn, FNN_DOCKERFILE],
  ];
  for (const [tag, dockerfile] of targets) {
    if (await imageExists(tag)) continue;
    if (config.imageRegistry !== undefined && (await pullImage(config.imageRegistry, tag, onLine))) {
      pulled.push(tag);
      continue;
    }
    await buildImage(tag, dockerfile, config, onLine);
    built.push(tag);
  }
  return { images, built, pulled };
}

/** Whether an image is one the lab built, including the per-run tags older versions left behind. */
export function isLabImage(name: string, networkPrefix: string): boolean {
  return (
    name.startsWith(`${FNN_IMAGE_NAME}:`) ||
    name.startsWith(`${CKB_IMAGE_NAME}:`) ||
    name.startsWith(`${networkPrefix}_`)
  );
}

export async function removeLabImages(config: GlobalConfig): Promise<string[]> {
  const listed = await docker(["images", "--format", "{{.Repository}}:{{.Tag}}"]);
  const removed: string[] = [];
  for (const image of listed.stdout.split(/\s+/).filter((name) => isLabImage(name, config.dockerNetworkPrefix))) {
    if ((await docker(["rmi", image])).code === 0) removed.push(image);
  }
  return removed;
}
