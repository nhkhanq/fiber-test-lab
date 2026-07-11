import type { ErrorCategory } from "./schema";

/**
 * Map raw RPC error message → ErrorCategory. FNN luôn trả code -32000 nên phải match theo substring
 * của message (xem docs/hands-on/rpc-notebook.md §8). Chỉ liệt kê mapping ĐÃ verify với node thật;
 * loại chưa gặp (E8) để dành. Thứ tự: cụ thể trước (cùng có "Failed to build route").
 */
const RULES: { pattern: RegExp; category: ErrorCategory }[] = [
  { pattern: /max outbound liquidity.*insufficient|Insufficient balance/i, category: "insufficient_outbound" },
  { pattern: /no path found|PathFind error/i, category: "no_route_found" },
];

export function mapError(message: string): ErrorCategory | null {
  for (const rule of RULES) if (rule.pattern.test(message)) return rule.category;
  return null;
}

/**
 * Phân loại 1 send_payment fail đã ghi → ErrorCategory. Peer offline cho lỗi TRÙNG insufficient_outbound
 * ("max outbound liquidity 0") nên phải ưu tiên tín hiệu `peerConnected` (E8-2) trước khi map theo message.
 */
export function classifyFailure(
  result: { error?: unknown; peerConnected?: boolean } | null,
): ErrorCategory | null {
  if (result?.peerConnected === false) return "peer_offline";
  return mapError(String(result?.error ?? ""));
}
