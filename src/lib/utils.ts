import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Clamp a number between min and max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Extract JSON from LLM output with 3-stage fallback:
 * 1. Direct parse of trimmed text
 * 2. Code fence extraction (```json ... ```)
 * 3. Find first JSON object or array in text
 * Returns parsed value or null if no valid JSON found.
 */
export function extractJSON(raw: string): unknown {
  const trimmed = raw.trim();

  // Stage 1: Direct parse
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  // Stage 2: Code fence extraction
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // fall through
    }
  }

  // Stage 3: Find first JSON object or array in text
  for (const pattern of [/\{[\s\S]*\}/, /\[[\s\S]*\]/]) {
    const match = trimmed.match(pattern);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through
      }
    }
  }

  return null;
}

/** Build headers with auth token when AUTH_SECRET is configured */
export function authHeaders(extra?: HeadersInit): HeadersInit {
  const secret = typeof window !== "undefined"
    ? (document.querySelector('meta[name="auth-secret"]') as HTMLMetaElement | null)?.content
    : undefined;
  const headers: Record<string, string> = {};
  if (secret) headers["Authorization"] = `Bearer ${secret}`;
  if (extra) {
    const entries = extra instanceof Headers ? Array.from(extra.entries()) : Object.entries(extra);
    for (const [k, v] of entries) headers[k] = v as string;
  }
  return headers;
}

/** Wrapper around fetch that automatically includes auth headers */
export function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: authHeaders(init?.headers),
  });
}
