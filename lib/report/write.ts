import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { RUNS_DIR } from "../constants";
import type { RunLog } from "../runlog/store";
import { buildReportModel } from "./model";
import { renderReport } from "./render";

/** Write one self-contained HTML report. Defaults to `.fiber-lab/runs/<run-id>.html`. */
export async function writeRunReport(log: RunLog, path: string = join(RUNS_DIR, `${log.runId}.html`)): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, renderReport(buildReportModel(log)), "utf8");
  return path;
}
