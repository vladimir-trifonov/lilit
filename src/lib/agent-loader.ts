/**
 * Agent loader — replaces hardcoded agents.ts.
 * Reads agent definitions from agents/{type}/AGENT.md + roles/*.md.
 * Uses YAML frontmatter for metadata, markdown body for system prompt.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { DEFAULT_CLAUDE_MODEL } from "./models";

const AGENTS_DIR = path.resolve(process.cwd(), "agents");

// --- Types ---

export interface PersonalityVoice {
  style: string;
  tone: string;
  tempo: string;
}

export interface PersonalityQuirks {
  catchphrases?: string[];
  pet_peeves?: string[];
  habits?: string[];
}

export interface PersonalityStandupVoice {
  pitch?: string;
  speed?: number;
  accent_hint?: string;
  sample_line?: string;
}

export interface ParsedPersonality {
  codename: string;
  voice: PersonalityVoice;
  opinions?: {
    strong?: string[];
    dislikes?: string[];
  };
  quirks?: PersonalityQuirks;
  strengths?: string[];
  weaknesses?: string[];
  standup_voice?: PersonalityStandupVoice;
}

export interface PersonalityOverlay {
  tone_shift?: string;
  additional_quirk?: string;
}

export interface RoleDefinition {
  role: string;
  name: string;
  description: string;
  provider?: string;
  model?: string;
  systemPrompt: string;
  personalityOverlay?: PersonalityOverlay;
  receivesPlanContext?: boolean;
  producesPassFail?: boolean;
  evaluatesOutput?: boolean;
  eventType?: string;
}

export interface AgentDefinition {
  type: string;
  name: string;
  description: string;
  provider?: string;
  model?: string;
  capabilities: string[];
  tags: string[];
  systemPrompt: string;
  roles: Record<string, RoleDefinition>;
  personality?: ParsedPersonality;
  personalitySeed?: string;
  icon?: string;
  color?: string;
  overwatchLens?: string;
  overwatchFocus?: string[];
  taskPreamble?: string;
  eventType?: string;
  ttsVoice?: string;
}

interface Frontmatter {
  name?: string;
  type?: string;
  role?: string;
  description?: string;
  provider?: string;
  model?: string;
  capabilities?: string[];
  tags?: string[];
  personality?: ParsedPersonality;
  personality_seed?: string;
  personality_overlay?: PersonalityOverlay;
  icon?: string;
  color?: string;
  overwatch_lens?: string;
  overwatch_focus?: string[];
  task_preamble?: string;
  event_type?: string;
  tts_voice?: string;
  receives_plan_context?: boolean;
  produces_pass_fail?: boolean;
  evaluates_output?: boolean;
}

// --- Frontmatter Parser ---

function parseFrontmatter(content: string): { meta: Frontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: content.trim() };
  }
  const meta = (yaml.load(match[1]) as Frontmatter) ?? {};
  return { meta, body: match[2].trim() };
}

// --- Loaders ---

function loadAgent(type: string): AgentDefinition | null {
  const agentDir = path.join(AGENTS_DIR, type);
  const agentFile = path.join(agentDir, "AGENT.md");

  if (!fs.existsSync(agentFile)) return null;

  const content = fs.readFileSync(agentFile, "utf-8");
  const { meta, body } = parseFrontmatter(content);

  const agent: AgentDefinition = {
    type: meta.type ?? type,
    name: meta.name ?? type,
    description: meta.description ?? "",
    provider: meta.provider,
    model: meta.model,
    capabilities: meta.capabilities ?? [],
    tags: meta.tags ?? [],
    systemPrompt: body,
    roles: {},
    personality: meta.personality,
    personalitySeed: meta.personality_seed,
    icon: meta.icon,
    color: meta.color,
    overwatchLens: meta.overwatch_lens,
    overwatchFocus: meta.overwatch_focus,
    taskPreamble: meta.task_preamble,
    eventType: meta.event_type,
    ttsVoice: meta.tts_voice,
  };

  // Load roles
  const rolesDir = path.join(agentDir, "roles");
  if (fs.existsSync(rolesDir)) {
    const roleFiles = fs.readdirSync(rolesDir).filter((f) => f.endsWith(".md"));
    for (const file of roleFiles) {
      const roleContent = fs.readFileSync(path.join(rolesDir, file), "utf-8");
      const { meta: roleMeta, body: roleBody } = parseFrontmatter(roleContent);
      const roleId = roleMeta.role ?? path.basename(file, ".md");
      agent.roles[roleId] = {
        role: roleId,
        name: roleMeta.name ?? roleId,
        description: roleMeta.description ?? "",
        provider: roleMeta.provider,
        model: roleMeta.model,
        systemPrompt: roleBody,
        personalityOverlay: roleMeta.personality_overlay,
        receivesPlanContext: roleMeta.receives_plan_context,
        producesPassFail: roleMeta.produces_pass_fail,
        evaluatesOutput: roleMeta.evaluates_output,
        eventType: roleMeta.event_type,
      };
    }
  }

  return agent;
}

function loadAllAgents(): Record<string, AgentDefinition> {
  if (!fs.existsSync(AGENTS_DIR)) return {};

  const dirs = fs.readdirSync(AGENTS_DIR).filter((d) => {
    const full = path.join(AGENTS_DIR, d);
    return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, "AGENT.md"));
  });

  const registry: Record<string, AgentDefinition> = {};
  for (const dir of dirs) {
    const agent = loadAgent(dir);
    if (agent) {
      registry[agent.type] = agent;
    }
  }
  return registry;
}

// --- Cached Registry ---

let cachedRegistry: Record<string, AgentDefinition> | null = null;

export function getAgentRegistry(refresh = false): Record<string, AgentDefinition> {
  if (!cachedRegistry || refresh) {
    cachedRegistry = loadAllAgents();
  }
  return cachedRegistry;
}

export function getAgent(type: string): AgentDefinition | null {
  return getAgentRegistry()[type] ?? null;
}

/**
 * Get the effective system prompt for an agent, considering role switching.
 */
export function getSystemPrompt(agentType: string, role?: string): string {
  const agent = getAgent(agentType);
  if (!agent) return "";

  if (role && agent.roles[role]) {
    return agent.roles[role].systemPrompt;
  }
  return agent.systemPrompt;
}

/**
 * Get the effective provider + model for an agent (with optional role override).
 */
export function getProviderConfig(
  agentType: string,
  role?: string
): { provider: string; model: string } {
  const agent = getAgent(agentType);
  if (!agent) {
    return { provider: "claude-code", model: DEFAULT_CLAUDE_MODEL };
  }

  const baseProvider = agent.provider ?? "claude-code";
  const baseModel = agent.model ?? DEFAULT_CLAUDE_MODEL;

  if (role && agent.roles[role]) {
    const roleConfig = agent.roles[role];
    return {
      provider: roleConfig.provider ?? baseProvider,
      model: roleConfig.model ?? baseModel,
    };
  }

  return { provider: baseProvider, model: baseModel };
}

/**
 * Check if an agent type uses Claude Code for execution.
 */
export function usesClaudeCode(agentType: string): boolean {
  const { provider } = getProviderConfig(agentType);
  return provider === "claude-code";
}

/**
 * Write/update an agent AGENT.md file.
 */
export function writeAgentFile(type: string, frontmatter: Frontmatter, body: string) {
  const agentDir = path.join(AGENTS_DIR, type);
  fs.mkdirSync(agentDir, { recursive: true });

  const yamlStr = yaml.dump(frontmatter, { lineWidth: -1 }).trim();
  const content = `---\n${yamlStr}\n---\n\n${body}\n`;
  fs.writeFileSync(path.join(agentDir, "AGENT.md"), content, "utf-8");

  // Invalidate cache
  cachedRegistry = null;
}

/**
 * Write/update a role .md file.
 */
export function writeRoleFile(type: string, role: string, frontmatter: Frontmatter, body: string) {
  const rolesDir = path.join(AGENTS_DIR, type, "roles");
  fs.mkdirSync(rolesDir, { recursive: true });

  const yamlStr = yaml.dump(frontmatter, { lineWidth: -1 }).trim();
  const content = `---\n${yamlStr}\n---\n\n${body}\n`;
  fs.writeFileSync(path.join(rolesDir, `${role}.md`), content, "utf-8");

  // Invalidate cache
  cachedRegistry = null;
}

/**
 * Delete an agent or role.
 */
export function deleteAgentOrRole(type: string, role?: string) {
  if (role) {
    const roleFile = path.join(AGENTS_DIR, type, "roles", `${role}.md`);
    if (fs.existsSync(roleFile)) fs.unlinkSync(roleFile);
  } else {
    const agentDir = path.join(AGENTS_DIR, type);
    if (fs.existsSync(agentDir)) fs.rmSync(agentDir, { recursive: true });
  }
  cachedRegistry = null;
}
