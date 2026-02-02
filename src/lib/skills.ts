/**
 * Skills system — loads skill markdown files and injects them into agent prompts.
 * 
 * Skills are stored in: ~/src/ai/lilit/skills/{skill-name}/SKILL.md
 * They get attached to agents based on project config or PM selection.
 * 
 * Skill format matches the industry standard (Claude Code, Codex, Gemini CLI etc.)
 */

import fs from "fs";
import fsp from "fs/promises";
import path from "path";

const SKILLS_DIR = path.resolve(__dirname, "../../skills");

export interface Skill {
  name: string;
  content: string;  // full markdown content
  description?: string;
  tags?: string[];   // e.g. ["nextjs", "react", "frontend"]
}

export interface SkillSet {
  developer?: string[];  // skill names for developer agent
  qa?: string[];
  architect?: string[];
  devops?: string[];
}

// Default skill sets per stack
export const STACK_SKILLS: Record<string, SkillSet> = {
  "nextjs": {
    developer: ["next-best-practices", "react-best-practices", "composition-patterns"],
    qa: ["webapp-testing"],
    architect: ["web-design-guidelines"],
  },
  "node": {
    developer: ["node-best-practices"],
    qa: ["webapp-testing"],
  },
  "python": {
    developer: ["modern-python"],
    qa: ["property-based-testing"],
  },
  "solidity": {
    developer: ["building-secure-contracts"],
    qa: ["property-based-testing", "static-analysis"],
  },
};

// Security skills — always available for review role
export const SECURITY_SKILLS = [
  "differential-review",
  "insecure-defaults",
  "static-analysis",
];

/**
 * Load a skill's content from disk.
 */
export function loadSkill(name: string): Skill | null {
  const skillPath = path.join(SKILLS_DIR, name, "SKILL.md");
  if (!fs.existsSync(skillPath)) return null;

  const content = fs.readFileSync(skillPath, "utf-8");

  // Parse optional frontmatter
  let description: string | undefined;
  let tags: string[] | undefined;
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fm = fmMatch[1];
    const descMatch = fm.match(/description:\s*(.+)/);
    const tagsMatch = fm.match(/tags:\s*\[(.+)\]/);
    if (descMatch) description = descMatch[1].trim();
    if (tagsMatch) tags = tagsMatch[1].split(",").map(t => t.trim());
  }

  return { name, content, description, tags };
}

/**
 * Load multiple skills and format them for injection into a system prompt.
 */
export function loadSkillsForPrompt(skillNames: string[]): string {
  const skills = skillNames
    .map(loadSkill)
    .filter((s): s is Skill => s !== null);

  if (skills.length === 0) return "";

  return skills
    .map(s => `\n## Skill: ${s.name}\n${s.content}`)
    .join("\n\n---\n");
}

/**
 * Get recommended skills for an agent based on project stack.
 */
export function getSkillsForAgent(
  agentType: string,
  role: string | undefined,
  stack: string
): string[] {
  const stackSkills = STACK_SKILLS[stack];
  if (!stackSkills) return [];

  const key = role === "devops" ? "devops" : agentType;
  const skills = stackSkills[key as keyof SkillSet] ?? [];

  // Add security skills for review role
  if (role === "review") {
    return [...skills, ...SECURITY_SKILLS];
  }

  return skills;
}

/**
 * List all available skills on disk.
 */
export function listAvailableSkills(): string[] {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs.readdirSync(SKILLS_DIR)
    .filter(d => fs.existsSync(path.join(SKILLS_DIR, d, "SKILL.md")));
}

/**
 * Swap skills in a project's .claude/skills/ directory.
 * Clears existing skills and copies the specified ones.
 * Claude Code reads these automatically when running.
 */
export async function swapProjectSkills(
  projectPath: string,
  skillNames: string[]
): Promise<void> {
  const targetDir = path.join(projectPath, ".claude", "skills");

  // Clear existing skills
  if (fs.existsSync(targetDir)) {
    const existing = fs.readdirSync(targetDir);
    for (const dir of existing) {
      const dirPath = path.join(targetDir, dir);
      if (fs.statSync(dirPath).isDirectory()) {
        fs.rmSync(dirPath, { recursive: true });
      }
    }
  } else {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Copy requested skills
  for (const name of skillNames) {
    const srcSkill = path.join(SKILLS_DIR, name, "SKILL.md");
    if (!fs.existsSync(srcSkill)) continue;

    const destDir = path.join(targetDir, name);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(srcSkill, path.join(destDir, "SKILL.md"));
  }
}
