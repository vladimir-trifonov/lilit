/**
 * AI-powered tech stack detection.
 * Uses the cheapest available AI provider to analyze project files
 * and determine the tech stack — no hardcoded patterns.
 */

import fs from "fs";
import path from "path";
import { getCheapestAvailableModel, getAdapter } from "./providers/registry";
import { CREW_APP_ROOT } from "@/lib/constants";

/** Max chars to read from a config file for the AI prompt. */
const CONFIG_FILE_SNIPPET_LENGTH = 2_000;

/** Max depth for recursive directory listing. */
const DIR_LIST_MAX_DEPTH = 3;

/** Max files to include in the directory listing. */
const DIR_LIST_MAX_FILES = 200;

/** Config files the AI should see (if they exist). */
const CONFIG_FILES = [
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "Gemfile",
  "composer.json",
  "pubspec.yaml",
  "Makefile",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "tsconfig.json",
];

/**
 * Recursively list directory contents up to a max depth.
 */
function listDir(dirPath: string, depth: number, maxFiles: number): string[] {
  if (depth <= 0) return [];
  const results: string[] = [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      // Skip hidden dirs, node_modules, .git, __pycache__, etc.
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "__pycache__" || entry.name === "venv" || entry.name === ".venv") {
        continue;
      }
      const rel = entry.name;
      if (entry.isDirectory()) {
        results.push(rel + "/");
        const sub = listDir(path.join(dirPath, entry.name), depth - 1, maxFiles - results.length);
        for (const s of sub) {
          results.push(rel + "/" + s);
        }
      } else {
        results.push(rel);
      }
    }
  } catch {
    // Can't read directory
  }

  return results;
}

/**
 * Read a config file snippet (first N chars).
 */
function readSnippet(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf-8");
    return content.slice(0, CONFIG_FILE_SNIPPET_LENGTH);
  } catch {
    return null;
  }
}

/**
 * Build a prompt for the AI to detect the tech stack.
 */
function buildDetectionPrompt(projectPath: string): string {
  const files = listDir(projectPath, DIR_LIST_MAX_DEPTH, DIR_LIST_MAX_FILES);
  const dirListing = files.length > 0 ? files.join("\n") : "(empty directory)";

  let configSnippets = "";
  for (const file of CONFIG_FILES) {
    const snippet = readSnippet(path.join(projectPath, file));
    if (snippet) {
      configSnippets += `\n--- ${file} ---\n${snippet}\n`;
    }
  }

  return `Analyze this project directory and identify its tech stack.

## Directory listing
${dirListing}

${configSnippets ? `## Config file contents\n${configSnippets}` : ""}

## Instructions
Based on the directory structure and config files above, identify the primary tech stack.
Respond with ONLY a short, lowercase identifier string (1-3 words, no explanation).
Examples: "nextjs", "react", "django", "fastapi", "rust", "go", "rails", "spring-boot", "flutter", "svelte", "vue", "angular", "express", "nestjs", "remix", "nuxt", "laravel", "phoenix"
If the stack uses multiple frameworks, name the primary one.
If you cannot determine the stack, respond with just "unknown".`;
}

/**
 * Detect stack from project directory using AI.
 * Falls back to null if no AI provider is available.
 */
export async function detectStack(projectPath: string): Promise<string | null> {
  try {
    const { provider, model } = await getCheapestAvailableModel();
    const adapter = getAdapter(provider);

    const prompt = buildDetectionPrompt(projectPath);

    const result = await adapter.execute({
      prompt,
      systemPrompt: "You are a tech stack identifier. You respond with only the stack name, nothing else.",
      model,
      maxTokens: 32,
    });

    if (result.success && result.output) {
      // Clean up the response — take first word/line, lowercase, strip punctuation
      const cleaned = result.output
        .trim()
        .split("\n")[0]
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "")
        .slice(0, 30);

      return cleaned && cleaned !== "unknown" ? cleaned : null;
    }
  } catch {
    // AI detection failure is non-fatal
  }

  return null;
}

/**
 * Validate project path exists and is accessible
 */
export function validateProjectPath(projectPath: string): { valid: boolean; error?: string } {
  try {
    if (!path.isAbsolute(projectPath)) {
      return { valid: false, error: "Path must be absolute" };
    }

    const resolved = path.resolve(path.normalize(projectPath));
    if (
      resolved === CREW_APP_ROOT ||
      CREW_APP_ROOT.startsWith(resolved + path.sep)
    ) {
      return { valid: false, error: "Cannot use the Lilit application directory as a project path" };
    }

    if (!fs.existsSync(resolved)) {
      return { valid: false, error: "Directory does not exist" };
    }

    const stats = fs.statSync(resolved);
    if (!stats.isDirectory()) {
      return { valid: false, error: "Path is not a directory" };
    }

    fs.readdirSync(resolved);
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Cannot access directory",
    };
  }
}

/**
 * Get project info from path
 */
export async function getProjectInfo(projectPath: string): Promise<{
  name: string;
  fileCount: number;
  detectedStack: string | null;
}> {
  const name = path.basename(projectPath);
  const detectedStack = await detectStack(projectPath);

  let fileCount = 0;
  try {
    const files = fs.readdirSync(projectPath);
    fileCount = files.length;
  } catch {}

  return { name, fileCount, detectedStack };
}
