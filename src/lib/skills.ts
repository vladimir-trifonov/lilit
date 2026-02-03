/**
 * Skills system — dynamically loads skill markdown files from skills/ directory.
 *
 * Skills are scanned at startup from: skills/{skill-name}/SKILL.md
 * Each SKILL.md has YAML frontmatter with tags that determine when it's used.
 * The PM can also explicitly assign skills per task in the plan.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";

const SKILLS_DIR = path.resolve(process.cwd(), "skills");

export interface Skill {
  name: string;
  description: string;
  tags: string[];   // e.g. ["nextjs", "react", "security", "review"]
  agents: string[]; // e.g. ["developer", "qa"] — empty means all agents
  content: string;  // full markdown content (body below frontmatter)
}

// --- Frontmatter parsing ---

interface SkillFrontmatter {
  name?: string;
  description?: string;
  tags?: string[] | string;
  agents?: string[] | string;
  [key: string]: unknown;
}

function parseSkillFile(filePath: string): Skill | null {
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

  let meta: SkillFrontmatter = {};
  let body = raw;

  if (match) {
    try {
      meta = (yaml.load(match[1]) as SkillFrontmatter) ?? {};
    } catch {
      // bad yaml, treat whole file as body
    }
    body = match[2].trim();
  }

  const dirName = path.basename(path.dirname(filePath));

  // Parse tags from frontmatter — support both array and comma-separated string
  let tags: string[] = [];
  if (Array.isArray(meta.tags)) {
    tags = meta.tags.map(String);
  } else if (typeof meta.tags === "string") {
    tags = meta.tags.split(",").map((t: string) => t.trim());
  }

  let agents: string[] = [];
  if (Array.isArray(meta.agents)) {
    agents = meta.agents.map(String);
  } else if (typeof meta.agents === "string") {
    agents = meta.agents.split(",").map((t: string) => t.trim());
  }

  return {
    name: (meta.name as string) ?? dirName,
    description: (meta.description as string) ?? "",
    tags,
    agents,
    content: body,
  };
}

// --- Registry (cached, scanned once) ---

let cachedSkills: Skill[] | null = null;

function scanSkills(): Skill[] {
  if (!fs.existsSync(SKILLS_DIR)) return [];

  const dirs = fs.readdirSync(SKILLS_DIR).filter((d) => {
    const full = path.join(SKILLS_DIR, d);
    return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, "SKILL.md"));
  });

  const skills: Skill[] = [];
  for (const dir of dirs) {
    const skill = parseSkillFile(path.join(SKILLS_DIR, dir, "SKILL.md"));
    if (skill) skills.push(skill);
  }
  return skills;
}

export function getSkillRegistry(refresh = false): Skill[] {
  if (!cachedSkills || refresh) {
    cachedSkills = scanSkills();
  }
  return cachedSkills;
}

/**
 * Load a single skill by name.
 */
export function loadSkill(name: string): Skill | null {
  return getSkillRegistry().find((s) => s.name === name) ?? null;
}

/**
 * List all available skill names.
 */
export function listAvailableSkills(): string[] {
  return getSkillRegistry().map((s) => s.name);
}

/**
 * Get skills for an agent+role+stack using tag matching.
 * A skill matches if:
 *   1. It has a tag matching the stack (e.g. "nextjs") OR has no stack tags (universal)
 *   2. It has no agents restriction, OR the agent is in the agents list
 *   3. For role-specific skills: tag matches the role (e.g. "review", "devops")
 */
export function getSkillsForAgent(
  agentType: string,
  role: string | undefined,
  stack: string,
): string[] {
  const all = getSkillRegistry();

  // Role tags are structurally tied to agent role directories — this set is stable.
  // Everything else is treated as a stack tag (no hardcoded stack list needed).
  const roleTags = new Set(["review", "code", "fix", "devops", "automation", "manual", "security"]);

  const matched: string[] = [];

  for (const skill of all) {
    // Check agent restriction
    if (skill.agents.length > 0 && !skill.agents.includes(agentType)) {
      continue;
    }

    const skillStackTags = skill.tags.filter((t) => !roleTags.has(t));
    const skillRoleTags = skill.tags.filter((t) => roleTags.has(t));

    // Stack matching: if skill has stack tags, at least one must match
    if (skillStackTags.length > 0 && !skillStackTags.includes(stack)) {
      continue;
    }

    // Role matching: if skill has role tags, at least one must match the current role
    if (skillRoleTags.length > 0) {
      const currentRole = role ?? "";
      // "security" tag matches "review" role
      const effectiveRoles = [currentRole];
      if (currentRole === "review") effectiveRoles.push("security");

      if (!skillRoleTags.some((t) => effectiveRoles.includes(t))) {
        continue;
      }
    }

    matched.push(skill.name);
  }

  return matched;
}

/**
 * Get skills by explicit name list (for PM-assigned skills).
 */
export function getSkillsByNames(names: string[]): Skill[] {
  const registry = getSkillRegistry();
  return names.map((n) => registry.find((s) => s.name === n)).filter((s): s is Skill => s !== null);
}

/**
 * Format skills as a summary list for inclusion in PM prompt.
 */
export function formatSkillsForPM(): string {
  const skills = getSkillRegistry();
  if (skills.length === 0) return "No skills available.";

  return skills
    .map((s) => {
      const tags = s.tags.length > 0 ? ` [${s.tags.join(", ")}]` : "";
      const agents = s.agents.length > 0 ? ` (agents: ${s.agents.join(", ")})` : "";
      return `- ${s.name}: ${s.description}${tags}${agents}`;
    })
    .join("\n");
}

/**
 * Format skill names as a prompt section for injection into agent prompts.
 * Returns empty string if no skills, so it's safe to prepend unconditionally.
 */
export function formatSkillsForPrompt(skillNames: string[]): string {
  if (skillNames.length === 0) return "";
  return `## Active Skills\nApply the following project skills for this task:\n${skillNames.map(s => `- ${s}`).join("\n")}\n\n`;
}

/**
 * Swap skills in a project's .claude/skills/ directory.
 * Clears existing skills and copies the specified ones.
 * Claude Code reads these automatically when running.
 */
export async function swapProjectSkills(
  projectPath: string,
  skillNames: string[],
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
  const srcDir = SKILLS_DIR;
  for (const name of skillNames) {
    const srcSkill = path.join(srcDir, name, "SKILL.md");
    if (!fs.existsSync(srcSkill)) continue;

    const destDir = path.join(targetDir, name);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(srcSkill, path.join(destDir, "SKILL.md"));
  }
}
