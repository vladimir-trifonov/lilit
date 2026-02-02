/**
 * Memory ingestion — auto-extracts memories from pipeline activity.
 * All functions are designed to be called fire-and-forget (.catch(() => {})).
 */

import { storeMemory } from "./memory";

// --- Decision Ingestion ---

/** Event types that represent meaningful decisions worth remembering. */
const DECISION_EVENT_TYPES = new Set([
  "plan_created",
  "architecture_defined",
  "review_done",
  "feedback_routed",
  "plan_rejected",
]);

/**
 * Ingest a decision memory from an event log entry.
 * Called after logEvent() for decision-type events.
 */
export async function ingestDecisionFromEvent(
  projectId: string,
  eventId: string,
  eventType: string,
  agent: string,
  role: string | undefined,
  data: Record<string, unknown>
): Promise<void> {
  if (!DECISION_EVENT_TYPES.has(eventType)) return;

  const summary =
    typeof data.summary === "string"
      ? data.summary
      : typeof data.analysis === "string"
        ? data.analysis
        : JSON.stringify(data).slice(0, 500);

  const title = buildDecisionTitle(eventType, agent, role);

  await storeMemory({
    projectId,
    agent,
    role,
    type: "decision",
    title,
    content: summary.slice(0, 2000),
    sourceType: "event_log",
    sourceId: eventId,
    significance: getDecisionSignificance(eventType),
  });
}

function buildDecisionTitle(
  eventType: string,
  agent: string,
  role?: string
): string {
  const who = role ? `${agent}:${role}` : agent;
  switch (eventType) {
    case "plan_created":
      return `Plan created by ${who}`;
    case "architecture_defined":
      return `Architecture decision by ${who}`;
    case "review_done":
      return `Code review by ${who}`;
    case "feedback_routed":
      return `Feedback routed through ${who}`;
    case "plan_rejected":
      return `Plan rejected — ${who}`;
    default:
      return `${eventType} by ${who}`;
  }
}

function getDecisionSignificance(eventType: string): number {
  switch (eventType) {
    case "architecture_defined":
      return 0.9;
    case "plan_created":
      return 0.7;
    case "plan_rejected":
      return 0.8;
    case "review_done":
      return 0.6;
    case "feedback_routed":
      return 0.5;
    default:
      return 0.5;
  }
}

// --- Personality Signal Extraction ---

/** Patterns that indicate an agent expressing a preference or opinion. */
const OPINION_PATTERNS = [
  /(?:I (?:prefer|recommend|suggest|would use|always use))\s+(.{10,100})/gi,
  /(?:should (?:always|never) (?:use|do|have|be))\s+(.{10,100})/gi,
  /(?:better (?:approach|pattern|way|practice) (?:is|would be))\s+(.{10,100})/gi,
  /(?:avoid|don't use|never use)\s+(.{10,100})/gi,
  /(?:convention|standard|pattern) (?:here |in this project )?(?:is|should be)\s+(.{10,100})/gi,
];

const MAX_SIGNALS_PER_RUN = 5;

/**
 * Extract opinion/preference signals from agent output.
 * Stores as personality-type memories.
 */
export async function ingestPersonalityFromAgentRun(
  projectId: string,
  agentRunId: string,
  agent: string,
  role: string | undefined,
  output: string
): Promise<void> {
  if (!output || output.length < 50) return;

  const signals: Array<{ match: string; pattern: number }> = [];

  for (let i = 0; i < OPINION_PATTERNS.length && signals.length < MAX_SIGNALS_PER_RUN; i++) {
    const pattern = new RegExp(OPINION_PATTERNS[i].source, OPINION_PATTERNS[i].flags);
    let match;
    while ((match = pattern.exec(output)) !== null && signals.length < MAX_SIGNALS_PER_RUN) {
      const captured = (match[1] ?? match[0]).trim();
      // Skip very short or very long matches
      if (captured.length >= 10 && captured.length <= 200) {
        signals.push({ match: captured, pattern: i });
      }
    }
  }

  for (let i = 0; i < signals.length; i++) {
    await storeMemory({
      projectId,
      agent,
      role,
      type: "personality",
      title: `${agent} preference`,
      content: signals[i].match,
      sourceType: "agent_run",
      sourceId: `${agentRunId}:signal:${i}`,
      significance: 0.4,
    });
  }
}

// --- Code Pattern Indexing ---

import fs from "fs";
import path from "path";

/** Files that define project conventions worth remembering. */
const CONVENTION_FILES = [
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.json",
  "eslint.config.mjs",
  "eslint.config.js",
  "tsconfig.json",
  "CONTRIBUTING.md",
  "CLAUDE.md",
  ".prettierrc",
  ".prettierrc.json",
  "prettier.config.js",
  ".editorconfig",
  "package.json",
];

/**
 * Index project convention files as code_pattern memories.
 * Called on project creation or manual re-index.
 */
export async function indexProjectCodePatterns(
  projectId: string,
  projectPath: string
): Promise<number> {
  let indexed = 0;

  for (const fileName of CONVENTION_FILES) {
    const filePath = path.join(projectPath, fileName);

    try {
      if (!fs.existsSync(filePath)) continue;

      const content = fs.readFileSync(filePath, "utf-8");
      // Skip very large files
      if (content.length > 10000) continue;

      // For package.json, extract only relevant sections
      let processedContent = content;
      if (fileName === "package.json") {
        try {
          const pkg = JSON.parse(content);
          processedContent = JSON.stringify(
            {
              scripts: pkg.scripts,
              dependencies: pkg.dependencies ? Object.keys(pkg.dependencies) : [],
              devDependencies: pkg.devDependencies ? Object.keys(pkg.devDependencies) : [],
            },
            null,
            2
          );
        } catch {
          // Use raw content if JSON parsing fails
        }
      }

      await storeMemory({
        projectId,
        type: "code_pattern",
        title: `Project convention: ${fileName}`,
        content: processedContent.slice(0, 3000),
        sourceType: "file_index",
        sourceId: `file:${fileName}`,
        significance: 0.7,
      });
      indexed++;
    } catch {
      // Skip files we can't read
    }
  }

  return indexed;
}
