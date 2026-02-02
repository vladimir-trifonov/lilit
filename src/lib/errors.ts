/**
 * Error classification for provider fallback decisions.
 * Pattern-matches error strings to determine retry strategy.
 */

export type ErrorKind = "transient" | "permanent" | "unknown";

const TRANSIENT_PATTERNS = [
  /429/,
  /rate.?limit/i,
  /quota/i,
  /RESOURCE_EXHAUSTED/,
  /ECONNREFUSED/,
  /ETIMEDOUT/,
  /ENOTFOUND/,
  /fetch failed/i,
  /timeout/i,
  /timed?\s*out/i,
  /503/,
  /502/,
  /service unavailable/i,
  /overloaded/i,
  /capacity/i,
  /SIGKILL/,
  /SIGTERM/,
];

const PERMANENT_PATTERNS = [
  /401/,
  /403/,
  /PERMISSION_DENIED/,
  /unauthorized/i,
  /forbidden/i,
  /api.?key/i,
  /authentication/i,
  /model not found/i,
  /invalid model/i,
  /INVALID_ARGUMENT/,
  /content policy/i,
  /safety/i,
];

export function classifyError(errorStr: string): ErrorKind {
  for (const pattern of PERMANENT_PATTERNS) {
    if (pattern.test(errorStr)) return "permanent";
  }
  for (const pattern of TRANSIENT_PATTERNS) {
    if (pattern.test(errorStr)) return "transient";
  }
  return "unknown";
}
