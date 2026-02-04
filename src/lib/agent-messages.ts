/**
 * Agent message extraction and routing for live inter-agent communication.
 *
 * Agents can emit structured messages to other agents during pipeline execution.
 * Messages are embedded in the agent's text output using a specific format:
 *
 *   [AGENT_MESSAGE]
 *   {"to": "developer", "type": "flag", "message": "..."}
 *   [/AGENT_MESSAGE]
 *
 * This module provides:
 *  - Prompt instructions that teach agents how to emit messages
 *  - Output parser that extracts messages from agent text
 *  - DB storage and retrieval for AgentMessage records
 *  - Inbox formatter for injecting received messages into prompts
 */

import { prisma } from "./prisma";
import { getCodename } from "./personality";
import { INBOX_MESSAGE_LIMIT, TEAM_CHAT_MESSAGE_LIMIT } from "@/lib/constants";

// ---- Types ----

export interface ParsedAgentMessage {
  to: string;
  type: "question" | "flag" | "suggestion" | "handoff" | "response" | "challenge" | "counter" | "concede" | "escalate" | "moderate";
  message: string;
}

export interface StoredAgentMessage {
  id: string;
  fromAgent: string;
  fromRole?: string | null;
  toAgent: string;
  messageType: string;
  content: string;
  phase: number;
  createdAt: Date;
}

// ---- Prompt instructions ----

const VALID_MESSAGE_TYPES = ["question", "flag", "suggestion", "handoff", "response", "challenge", "counter", "concede", "escalate", "moderate"];

/**
 * Returns prompt instructions that teach an agent how to emit messages.
 * Append this to the agent's prompt when inter-agent messaging is enabled.
 */
export function getMessageInstructions(agentType: string, otherAgents: string[]): string {
  const recipients = otherAgents.filter((a) => a !== agentType);
  if (recipients.length === 0) return "";

  const recipientList = recipients
    .map((a) => {
      const codename = getCodename(a);
      return codename !== a ? `- ${a} (${codename})` : `- ${a}`;
    })
    .join("\n");

  return `
## Inter-Agent Communication

You can send messages to other agents currently working on this pipeline.

Send a message when:
- You DISAGREE with an approach or decision — say so directly
- You have a QUESTION another agent should answer
- You spotted a TENSION, risk, or concern the recipient needs to know
- You want to HAND OFF context to the next agent

Your opinions matter. If something conflicts with your beliefs, speak up.
Do NOT stay silent when you see a problem.

Do NOT send messages for:
- Status updates (the live log handles that)
- Generic encouragement or acknowledgments

Available recipients:
${recipientList}

To send a message, include this block anywhere in your output:

[AGENT_MESSAGE]
{"to": "<agent_type>", "type": "<question|flag|suggestion|handoff>", "message": "<your message>"}
[/AGENT_MESSAGE]

Message types:
- question: You need information from this agent
- flag: You detected a tension or issue relevant to this agent
- suggestion: A non-blocking recommendation
- handoff: Context for the agent who runs after you
`;
}

// ---- Output parsing ----

/**
 * Extract inter-agent messages from agent output text.
 * Returns the original text with message blocks stripped, plus parsed messages.
 */
export function extractMessages(output: string): {
  cleanOutput: string;
  messages: ParsedAgentMessage[];
} {
  const messages: ParsedAgentMessage[] = [];
  const blockRe = /\[AGENT_MESSAGE\]\s*\n?\s*(\{[\s\S]*?\})\s*\n?\s*\[\/AGENT_MESSAGE\]/g;

  const cleanOutput = output.replace(blockRe, (_, json: string) => {
    try {
      const parsed = JSON.parse(json);
      if (
        parsed.to &&
        parsed.type &&
        parsed.message &&
        VALID_MESSAGE_TYPES.includes(parsed.type)
      ) {
        messages.push({
          to: parsed.to,
          type: parsed.type,
          message: parsed.message,
        });
      }
    } catch {
      // Malformed JSON — skip this block
    }
    return ""; // Strip the block from output
  });

  return { cleanOutput: cleanOutput.trim(), messages };
}

// ---- DB operations ----

/**
 * Store extracted messages in the AgentMessage table.
 */
export async function storeMessages(opts: {
  pipelineRunId: string;
  fromAgent: string;
  fromRole?: string;
  phase: number;
  messages: ParsedAgentMessage[];
}): Promise<StoredAgentMessage[]> {
  const stored: StoredAgentMessage[] = [];

  for (const msg of opts.messages) {
    const record = await prisma.agentMessage.create({
      data: {
        pipelineRunId: opts.pipelineRunId,
        fromAgent: opts.fromAgent,
        fromRole: opts.fromRole,
        toAgent: msg.to,
        messageType: msg.type,
        content: msg.message,
        phase: opts.phase,
      },
    });
    stored.push(record);
  }

  return stored;
}

/**
 * Retrieve inbox messages for a specific agent in a pipeline run.
 * Returns messages addressed TO this agent, ordered by creation time.
 */
export async function getInboxMessages(opts: {
  pipelineRunId: string;
  toAgent: string;
}): Promise<StoredAgentMessage[]> {
  return prisma.agentMessage.findMany({
    where: {
      pipelineRunId: opts.pipelineRunId,
      toAgent: opts.toAgent,
    },
    orderBy: { createdAt: "asc" },
    take: INBOX_MESSAGE_LIMIT,
  });
}

/**
 * Get all messages for a pipeline run (for UI display).
 */
export async function getAllMessages(pipelineRunId: string): Promise<StoredAgentMessage[]> {
  return prisma.agentMessage.findMany({
    where: { pipelineRunId },
    orderBy: { createdAt: "asc" },
    take: TEAM_CHAT_MESSAGE_LIMIT,
  });
}

// ---- Prompt formatting ----

/**
 * Format inbox messages for injection into an agent's prompt.
 *
 * When voiceEnabled is true, messages are labeled as "[Voice message from X]"
 * to create the theatrical effect of agents hearing each other speak.
 */
const DEBATE_TYPES = new Set(["challenge", "counter", "concede", "escalate", "moderate"]);

export function formatInboxForPrompt(messages: StoredAgentMessage[], voiceEnabled = false): string {
  if (messages.length === 0) return "";

  // Separate regular messages from debate messages
  const regularMessages = messages.filter((m) => !DEBATE_TYPES.has(m.messageType));
  const debateMessages = messages.filter((m) => DEBATE_TYPES.has(m.messageType));

  const sections: string[] = [];

  if (regularMessages.length > 0) {
    const formatted = regularMessages
      .map((m) => {
        const codename = getCodename(m.fromAgent);
        const sender = codename !== m.fromAgent ? `${codename} (${m.fromAgent})` : m.fromAgent;
        const prefix = voiceEnabled ? "Voice message" : "Message";
        return `- [${prefix}] [${m.messageType}] from ${sender}: ${m.content}`;
      })
      .join("\n");

    const header = voiceEnabled
      ? "## Voice Messages From Other Agents\n\nThe following voice messages were left for you by other agents working on this pipeline. Each agent spoke these messages aloud during their pipeline phase:"
      : "## Messages From Other Agents\n\nThe following messages were left for you by other agents working on this pipeline:";

    sections.push(`${header}\n\n${formatted}`);
  }

  if (debateMessages.length > 0) {
    const formatted = debateMessages
      .map((m) => {
        const codename = getCodename(m.fromAgent);
        const sender = codename !== m.fromAgent ? `${codename} (${m.fromAgent})` : m.fromAgent;
        return `- [${m.messageType}] ${sender}: ${m.content}`;
      })
      .join("\n");

    sections.push(`## Debate Results From This Pipeline\n\n${formatted}`);
  }

  sections.push("Consider these messages when doing your work. If a question was asked of you, address it in your output. If a flag or suggestion was raised, factor it into your approach.");

  return "\n" + sections.join("\n\n") + "\n";
}
