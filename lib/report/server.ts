import { createServer, type Server, type ServerResponse } from "node:http";
import { buildReportModel } from "./model";
import { renderReport, renderRunList } from "./render";
import { listRuns, RunLogStore } from "../runlog/store";

/** The `fiber-lab ui` server. Read-only on purpose: its only data source is `.fiber-lab/runs/`.
 *  It never calls FNN RPC and never imports the orchestrator, so the CLI stays the single control
 *  surface and every action a cluster ever sees is in a run-log (decisions-log 2026-09-22). */

const LOOPBACK = "127.0.0.1";

export interface UiServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

const RUN_PATH = /^\/run\/([A-Za-z0-9_-]+?)(\.json)?$/;

function send(
  res: ServerResponse,
  status: number,
  contentType: string,
  body: string,
): void {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  res.end(body);
}

export function startUiServer(options: { port?: number } = {}): Promise<UiServer> {
  const server: Server = createServer((req, res) => {
    const url = req.url ?? "/";

    void (async () => {
      try {
        if (url === "/" || url === "/index.html") {
          const runs = await listRuns();
          send(
            res,
            200,
            "text/html; charset=utf-8",
            renderRunList(
              runs.map((run) => ({
                runId: run.runId,
                scenario: run.scenario,
                status: run.status,
                startedAt: run.startedAt,
                steps: run.steps.length,
              })),
            ),
          );
          return;
        }

        const match = RUN_PATH.exec(url);
        if (match) {
          // Re-read from disk on every request: a live `up` is still appending to this file.
          const log = await RunLogStore.load(match[1]!).catch(() => null);
          if (log === null) {
            send(res, 404, "text/plain; charset=utf-8", `No run-log for "${match[1]}"`);
            return;
          }
          const model = buildReportModel(log);
          if (match[2] === ".json") {
            send(res, 200, "application/json; charset=utf-8", JSON.stringify(model));
          } else {
            send(
              res,
              200,
              "text/html; charset=utf-8",
              renderReport(model, { live: true, backHref: "/" }),
            );
          }
          return;
        }

        send(res, 404, "text/plain; charset=utf-8", "Not found");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        send(res, 500, "text/plain; charset=utf-8", message);
      }
    })();
  });

  return new Promise<UiServer>((resolve, reject) => {
    server.once("error", reject);
    // Loopback only — never 0.0.0.0. The viewer exposes a run-log, which holds node pubkeys,
    // container names and every raw RPC of the run.
    server.listen(options.port ?? 0, LOOPBACK, () => {
      server.removeListener("error", reject);
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        url: `http://${LOOPBACK}:${port}/`,
        port,
        close: () =>
          new Promise<void>((done, fail) =>
            server.close((error) => (error ? fail(error) : done())),
          ),
      });
    });
  });
}
