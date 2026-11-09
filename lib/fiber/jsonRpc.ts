export interface RpcCallRecord {
  node: string;
  method: string;
  params: unknown;
  response?: unknown;
  error?: unknown;
  at: string; // ISO8601
  durationMs?: number;
}

export type RpcLogger = (record: RpcCallRecord) => void;

export interface JsonRpcRequest {
  node: string;
  endpoint: string;
  method: string;
  params: unknown[];
  timeoutMs: number;
  logger?: RpcLogger;
}

export async function jsonRpcCall(request: JsonRpcRequest): Promise<unknown> {
  const { node, endpoint, method, params, timeoutMs, logger } = request;
  const at = new Date().toISOString();
  const started = performance.now();
  const durationMs = () => Math.round(performance.now() - started);

  let json: { result?: unknown; error?: { message?: string } };
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: Date.now() }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    json = (await res.json()) as typeof json;
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    const failure = timedOut ? new Error(`RPC ${method} timed out after ${timeoutMs}ms (${node})`) : error;
    logger?.({ node, method, params, error: failure, at, durationMs: durationMs() });
    throw failure;
  }

  if (json.error) {
    logger?.({ node, method, params, error: json.error, at, durationMs: durationMs() });
    throw new Error(`RPC ${method} failed: ${json.error.message ?? JSON.stringify(json.error)}`);
  }
  logger?.({ node, method, params, response: json.result, at, durationMs: durationMs() });
  return json.result;
}
