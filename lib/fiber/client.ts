import { ccc } from "@ckb-ccc/core";
import { FiberSDK, fiber } from "@ckb-ccc/fiber";

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

export interface FiberClientOptions {
  endpoints: Record<string, string>;
  timeoutMs?: number;
  logger?: RpcLogger;
}

export class FiberClient {
  readonly #endpoints: Record<string, string>;
  readonly #timeoutMs: number;
  readonly #logger?: RpcLogger;
  readonly #sdks = new Map<string, FiberSDK>();

  constructor(options: FiberClientOptions) {
    this.#endpoints = options.endpoints;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#logger = options.logger;
  }

  #sdk(node: string): FiberSDK {
    let sdk = this.#sdks.get(node);
    if (!sdk) {
      const endpoint = this.#endpoints[node];
      if (!endpoint) {
        throw new Error(
          `Unknown node "${node}" — no endpoint configured (have: ${Object.keys(this.#endpoints).join(", ") || "none"})`,
        );
      }
      sdk = new FiberSDK({ endpoint, timeout: this.#timeoutMs });
      this.#sdks.set(node, sdk);
    }
    return sdk;
  }

  async #call<T>(
    node: string,
    method: string,
    params: unknown,
    fn: (sdk: FiberSDK) => Promise<T>,
  ): Promise<T> {
    const at = new Date().toISOString();
    const started = performance.now();
    const durationMs = () => Math.round(performance.now() - started);
    try {
      const response = await fn(this.#sdk(node));
      this.#logger?.({ node, method, params, response, at, durationMs: durationMs() });
      return response;
    } catch (error) {
      this.#logger?.({ node, method, params, error, at, durationMs: durationMs() });
      throw error;
    }
  }


  async rawCall(node: string, method: string, params: unknown[] = []): Promise<unknown> {
    const at = new Date().toISOString();
    const started = performance.now();
    const durationMs = () => Math.round(performance.now() - started);
    const endpoint = this.#endpoints[node];
    if (!endpoint) throw new Error(`Unknown node "${node}" — no endpoint configured`);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: Date.now() }),
      });
      const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (json.error) {
        this.#logger?.({ node, method, params, error: json.error, at, durationMs: durationMs() });
        throw new Error(`RPC ${method} failed: ${json.error.message ?? JSON.stringify(json.error)}`);
      }
      this.#logger?.({ node, method, params, response: json.result, at, durationMs: durationMs() });
      return json.result;
    } catch (error) {
      this.#logger?.({ node, method, params, error, at, durationMs: durationMs() });
      throw error;
    }
  }


  getNodeInfo(node: string): Promise<fiber.NodeInfo> {
    return this.#call(node, "node_info", {}, (sdk) => sdk.getNodeInfo());
  }

  listChannels(node: string, params: fiber.ListChannelsParamsLike = {}): Promise<fiber.Channel[]> {
    return this.#call(node, "list_channels", params, (sdk) => sdk.listChannels(params));
  }

  listPeers(node: string): Promise<fiber.PeerInfo[]> {
    return this.#call(node, "list_peers", {}, (sdk) => sdk.listPeers());
  }

  connectPeer(node: string, params: fiber.ConnectPeerParamsLike): Promise<void> {
    return this.#call(node, "connect_peer", params, (sdk) => sdk.connectPeer(params));
  }

  openChannel(node: string, params: fiber.OpenChannelParamsLike): Promise<ccc.Hex> {
    return this.#call(node, "open_channel", params, (sdk) => sdk.openChannel(params));
  }

  newInvoice(node: string, params: fiber.NewInvoiceParamsLike): Promise<fiber.NewInvoiceResult> {
    return this.#call(node, "new_invoice", params, (sdk) => sdk.newInvoice(params));
  }

  sendPayment(node: string, params: fiber.SendPaymentCommandParamsLike): Promise<fiber.PaymentResult> {
    return this.#call(node, "send_payment", params, (sdk) => sdk.sendPayment(params));
  }

  getPayment(node: string, paymentHash: ccc.HexLike): Promise<fiber.PaymentResult> {
    return this.#call(node, "get_payment", { paymentHash }, (sdk) => sdk.getPayment(paymentHash));
  }

  shutdownChannel(node: string, params: fiber.ShutdownChannelParamsLike): Promise<void> {
    return this.#call(node, "shutdown_channel", params, (sdk) => sdk.shutdownChannel(params));
  }
}
