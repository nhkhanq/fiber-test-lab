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
