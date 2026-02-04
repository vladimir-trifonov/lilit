/**
 * GET /api/standups/trends — detect recurring themes from standup messages.
 *
 * Query parameters:
 *   - projectId  (string, required)
 *   - resolved   (boolean, optional) — filter by resolution status.
 *                 "resolved" = message belongs to a completed pipeline run;
 *                 "unresolved" = message belongs to a running/failed/aborted run.
 *
 * Response (200):
 * {
 *   "trends": [
 *     {
 *       "theme": "missing-loading-states",
 *       "insightType": "cross-concern",
 *       "occurrences": 3,
 *       "lastSeenAt": "2026-02-02T12:00:00Z",
 *       "resolved": false
 *     }
 *   ]
 * }
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { STANDUP_TRENDS_LIMIT } from "@/lib/constants";

export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ */
/*  Stop-words excluded from theme extraction                         */
/* ------------------------------------------------------------------ */

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "shall",
  "should", "may", "might", "must", "can", "could", "to", "of", "in",
  "for", "on", "with", "at", "by", "from", "as", "into", "through",
  "during", "before", "after", "above", "below", "between", "out",
  "off", "over", "under", "again", "further", "then", "once", "here",
  "there", "when", "where", "why", "how", "all", "each", "every",
  "both", "few", "more", "most", "other", "some", "such", "no", "nor",
  "not", "only", "own", "same", "so", "than", "too", "very", "just",
  "because", "but", "and", "or", "if", "while", "about", "up", "it",
  "its", "this", "that", "these", "those", "i", "we", "you", "he",
  "she", "they", "me", "him", "her", "us", "them", "my", "your",
  "his", "our", "their", "what", "which", "who", "whom", "also",
  "any", "many", "much", "still", "already", "yet", "even", "make",
  "need", "use", "using", "used", "ensure", "consider", "like",
]);

/* ------------------------------------------------------------------ */
/*  Theme extraction helpers                                          */
/* ------------------------------------------------------------------ */

/**
 * Extract candidate theme phrases from a standup message.
 *
 * Strategy:
 *  1. Preserve hyphenated compound terms as-is (e.g. "loading-states").
 *  2. Build bigrams from the remaining non-stop words.
 *  3. Keep individual significant words (length >= 5) as fallback unigrams.
 *
 * Returns a deduplicated, lowercased set of candidate phrases.
 */
function extractPhrases(text: string): string[] {
  const normalised = text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ");

  const phrases: Set<string> = new Set();

  // 1. Hyphenated compounds (e.g. "missing-loading-states")
  const hyphenated = normalised.match(/[a-z]+-[a-z]+(?:-[a-z]+)*/g) ?? [];
  for (const h of hyphenated) {
    phrases.add(h);
  }

  // 2. Tokenise, strip stop words, build bigrams + significant unigrams
  const tokens = normalised
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t));

  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = `${tokens[i]}-${tokens[i + 1]}`;
    phrases.add(bigram);
  }

  for (const t of tokens) {
    if (t.length >= 5) {
      phrases.add(t);
    }
  }

  return Array.from(phrases);
}

/**
 * Given a set of messages, group them into themes based on shared phrases.
 *
 * Each message can contribute to multiple themes. After grouping we keep only
 * themes that appear in at least 2 messages (single-occurrence insights are
 * not yet a "trend"). Themes are sorted by occurrence count descending.
 */
function detectThemes(
  messages: {
    id: string;
    insightType: string;
    message: string;
    createdAt: Date;
    pipelineRun: { status: string };
  }[]
): {
  theme: string;
  insightType: string;
  occurrences: number;
  lastSeenAt: string;
  resolved: boolean;
}[] {
  // phrase -> { insightType, messageIds, latestDate, resolvedCount, unresolvedCount }
  const phraseMap = new Map<
    string,
    {
      insightType: string;
      messageIds: Set<string>;
      latestDate: Date;
      resolvedCount: number;
      unresolvedCount: number;
    }
  >();

  for (const msg of messages) {
    const phrases = extractPhrases(msg.message);
    const isResolved = msg.pipelineRun.status === "completed";

    for (const phrase of phrases) {
      const key = `${msg.insightType}::${phrase}`;
      const existing = phraseMap.get(key);

      if (existing) {
        existing.messageIds.add(msg.id);
        if (msg.createdAt > existing.latestDate) {
          existing.latestDate = msg.createdAt;
        }
        if (isResolved) {
          existing.resolvedCount++;
        } else {
          existing.unresolvedCount++;
        }
      } else {
        phraseMap.set(key, {
          insightType: msg.insightType,
          messageIds: new Set([msg.id]),
          latestDate: msg.createdAt,
          resolvedCount: isResolved ? 1 : 0,
          unresolvedCount: isResolved ? 0 : 1,
        });
      }
    }
  }

  // Filter to phrases seen in >= 2 distinct messages
  const trends: {
    theme: string;
    insightType: string;
    occurrences: number;
    lastSeenAt: string;
    resolved: boolean;
  }[] = [];

  for (const [key, data] of phraseMap) {
    if (data.messageIds.size < 2) continue;

    const theme = key.split("::")[1];
    trends.push({
      theme,
      insightType: data.insightType,
      occurrences: data.messageIds.size,
      lastSeenAt: data.latestDate.toISOString(),
      resolved: data.unresolvedCount === 0,
    });
  }

  // Sort by occurrences descending, then by lastSeenAt descending
  trends.sort((a, b) => {
    if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
    return b.lastSeenAt.localeCompare(a.lastSeenAt);
  });

  // De-duplicate overlapping themes: if a longer phrase fully contains a
  // shorter one within the same insightType and the shorter one does not
  // cover additional messages, drop the shorter theme.
  const deduped: typeof trends = [];
  const seen = new Set<string>();

  for (const trend of trends) {
    const typeKey = `${trend.insightType}::${trend.theme}`;
    if (seen.has(typeKey)) continue;

    // Check whether any already-accepted trend of the same insightType
    // is a superstring of this theme with equal or greater occurrences.
    const dominated = deduped.some(
      (existing) =>
        existing.insightType === trend.insightType &&
        existing.theme.includes(trend.theme) &&
        existing.occurrences >= trend.occurrences
    );

    if (!dominated) {
      deduped.push(trend);
      seen.add(typeKey);
    }
  }

  return deduped;
}

/* ------------------------------------------------------------------ */
/*  Route handler                                                     */
/* ------------------------------------------------------------------ */

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const resolvedParam = searchParams.get("resolved");

  if (!projectId) {
    return NextResponse.json(
      { error: "projectId is required" },
      { status: 400 }
    );
  }

  // Build the query filter
  const where: Record<string, unknown> = {
    insightType: { not: "none" },
    actionable: true,
    pipelineRun: { projectId },
  };

  // When resolved filter is set, narrow to pipeline run status.
  // "resolved" (true)  = pipeline completed successfully
  // "resolved" (false) = pipeline running, failed, or aborted
  if (resolvedParam !== null) {
    const wantResolved = resolvedParam === "true";
    where.pipelineRun = {
      projectId,
      status: wantResolved ? "completed" : { not: "completed" },
    };
  }

  const messages = await prisma.standupMessage.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: STANDUP_TRENDS_LIMIT,
    select: {
      id: true,
      insightType: true,
      message: true,
      createdAt: true,
      pipelineRun: {
        select: { status: true },
      },
    },
  });

  const trends = detectThemes(messages);

  return NextResponse.json({ trends });
}
