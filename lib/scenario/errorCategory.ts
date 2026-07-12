import type { ErrorCategory } from "./schema";

const RULES: { pattern: RegExp; category: ErrorCategory }[] = [
  { pattern: /invoice is expired|invoice.*expired/i, category: "invoice_expired" },
  { pattern: /max outbound liquidity.*insufficient|Insufficient balance/i, category: "insufficient_outbound" },
  { pattern: /no path found|PathFind error/i, category: "no_route_found" },
];

export function mapError(message: string): ErrorCategory | null {
  for (const rule of RULES) if (rule.pattern.test(message)) return rule.category;
  return null;
}

export function classifyFailure(
  result: { error?: unknown; peerConnected?: boolean } | null,
): ErrorCategory | null {
  if (result?.peerConnected === false) return "peer_offline";
  return mapError(String(result?.error ?? ""));
}
