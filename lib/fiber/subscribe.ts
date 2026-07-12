import WebSocket from "ws";
import type { GlobalConfig } from "../config";

const TERMINAL = new Set(["Success", "Failed"]);

interface PaymentSessionEvent {
  PutPaymentSession?: { payment_hash: string; payment_session: { status: string } };
}

export interface PaymentWatcher {
  wait(hash: string): Promise<{ status: string }>;
  close(): void;
}

export function subscribePayments(endpoint: string, config: GlobalConfig): Promise<PaymentWatcher> {
  const ws = new WebSocket(endpoint.replace(/^http/, "ws"));
  const latest = new Map<string, string>(); // payment_hash -> latest status
  const waiters = new Map<string, (status: string) => void>();

  ws.on("message", (data: WebSocket.RawData) => {
    const msg = JSON.parse(data.toString());
    const change = msg?.params?.result as PaymentSessionEvent | undefined;
    const put = change?.PutPaymentSession;
    if (!put) return;
    latest.set(put.payment_hash, put.payment_session.status);
    if (TERMINAL.has(put.payment_session.status)) waiters.get(put.payment_hash)?.(put.payment_session.status);
  });

  return new Promise((resolve, reject) => {
    ws.once("error", reject);
    ws.once("open", () => {
      ws.send(JSON.stringify({ id: 1, jsonrpc: "2.0", method: "subscribe_store_changes", params: [] }));
      resolve({
        wait(hash) {
          const current = latest.get(hash);
          if (current && TERMINAL.has(current)) return Promise.resolve({ status: current });
          return new Promise((res, rej) => {
            const timer = setTimeout(() => {
              waiters.delete(hash);
              rej(new Error(`Timed out after ${config.pollTimeoutMs}ms waiting for the payment event ${hash.slice(0, 12)}…`));
            }, config.pollTimeoutMs);
            waiters.set(hash, (status) => {
              clearTimeout(timer);
              waiters.delete(hash);
              res({ status });
            });
          });
        },
        close: () => ws.close(),
      });
    });
  });
}
