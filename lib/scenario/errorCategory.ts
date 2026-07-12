import type { ErrorCategory } from "./schema";

// FNN always returns JSON-RPC code -32000, so failures are classified by matching a substring of the message.
// Only mappings verified against a live node are listed.
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
  // An offline peer produces the same "max outbound liquidity 0" message as insufficient_outbound,
  // so the connectivity signal takes priority over the message match.
  if (result?.peerConnected === false) return "peer_offline";
  return mapError(String(result?.error ?? ""));
}
