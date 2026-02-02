/**
 * Auto-detect tech stack from project files
 */

import fs from "fs";
import path from "path";
import type { StackType } from "@/types/settings";

interface StackIndicators {
  files: string[];
  patterns?: RegExp[];
  priority: number;
}

const STACK_INDICATORS: Record<StackType, StackIndicators> = {
  nextjs: {
    files: ["next.config.js", "next.config.mjs", "next.config.ts", "app/layout.tsx", "app/page.tsx"],
    patterns: [/"next":\s*"[\d.]+"/],
    priority: 10,
  },
  react: {
    files: ["src/App.tsx", "src/App.jsx", "public/index.html"],
    patterns: [/"react":\s*"[\d.]+"/],
    priority: 8,
  },
  vue: {
    files: ["vue.config.js", "src/App.vue", "vite.config.ts"],
    patterns: [/"vue":\s*"[\d.]+"/],
    priority: 8,
  },
  svelte: {
    files: ["svelte.config.js", "src/App.svelte"],
    patterns: [/"svelte":\s*"[\d.]+"/],
    priority: 8,
  },
  nodejs: {
    files: ["package.json", "index.js", "server.js", "app.js"],
    patterns: [/"express":\s*"[\d.]+"/],
    priority: 5,
  },
  django: {
    files: ["manage.py", "settings.py", "wsgi.py", "requirements.txt"],
    patterns: [/Django==/],
    priority: 10,
  },
  fastapi: {
    files: ["main.py", "requirements.txt", "pyproject.toml"],
    patterns: [/fastapi==/],
    priority: 10,
  },
  python: {
    files: ["requirements.txt", "setup.py", "pyproject.toml", "main.py"],
    patterns: [/python_requires/],
    priority: 5,
  },
};

/**
 * Detect stack from project directory
 */
export async function detectStack(projectPath: string): Promise<StackType | null> {
  const scores: Record<StackType, number> = {
    nextjs: 0,
    react: 0,
    vue: 0,
    svelte: 0,
    nodejs: 0,
    python: 0,
    django: 0,
    fastapi: 0,
  };

  // Check for indicator files
  for (const [stack, indicators] of Object.entries(STACK_INDICATORS)) {
    for (const file of indicators.files) {
      const filePath = path.join(projectPath, file);
      if (fs.existsSync(filePath)) {
        scores[stack as StackType] += indicators.priority;
      }
    }

    // Check patterns in package.json / requirements.txt
    if (indicators.patterns) {
      const packageJson = path.join(projectPath, "package.json");
      const requirements = path.join(projectPath, "requirements.txt");

      if (fs.existsSync(packageJson)) {
        try {
          const content = fs.readFileSync(packageJson, "utf-8");
          for (const pattern of indicators.patterns) {
            if (pattern.test(content)) {
              scores[stack as StackType] += indicators.priority;
            }
          }
        } catch {}
      }

      if (fs.existsSync(requirements)) {
        try {
          const content = fs.readFileSync(requirements, "utf-8");
          for (const pattern of indicators.patterns) {
            if (pattern.test(content)) {
              scores[stack as StackType] += indicators.priority;
            }
          }
        } catch {}
      }
    }
  }

  // Find stack with highest score
  let bestStack: StackType | null = null;
  let bestScore = 0;

  for (const [stack, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestStack = stack as StackType;
    }
  }

  return bestScore > 0 ? bestStack : null;
}

/**
 * Validate project path exists and is accessible
 */
export function validateProjectPath(projectPath: string): { valid: boolean; error?: string } {
  try {
    if (!fs.existsSync(projectPath)) {
      return { valid: false, error: "Path does not exist" };
    }

    const stats = fs.statSync(projectPath);
    if (!stats.isDirectory()) {
      return { valid: false, error: "Path is not a directory" };
    }

    // Check if we can read the directory
    fs.readdirSync(projectPath);

    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Cannot access directory",
    };
  }
}

/**
 * Get project info from path (name, size, file count)
 */
export async function getProjectInfo(projectPath: string): Promise<{
  name: string;
  fileCount: number;
  detectedStack: StackType | null;
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
