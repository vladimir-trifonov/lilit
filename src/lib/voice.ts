/**
 * Voice synthesis engine — TTS for agent standup messages.
 *
 * Reads standup_voice config from agent personality frontmatter and calls
 * OpenAI TTS API to generate audio. Audio files are cached on disk.
 *
 * Provider abstraction: only OpenAI supported for now. ElevenLabs or local
 * TTS can be added by implementing the same synthesize() signature.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { getPersonality } from "./personality";
import type { VoiceProvider } from "@/types/settings";
import { AGENT } from "@/lib/models";

// ---- Types ----

export interface VoiceConfig {
  provider: VoiceProvider;
  voiceId: string;
  speed: number;
  pitch: string;
  accentHint: string;
}

export interface SynthesisResult {
  filePath: string;
  durationMs: number;
  cached: boolean;
}

// ---- Voice ID mapping ----

// Maps agent types to OpenAI TTS voices based on personality standup_voice hints.
// These were chosen to match the personality profiles:
//   Sasha (PM):        alloy    — warm, professional
//   Marcus (Architect): onyx    — deep, deliberate
//   Kai (Developer):    echo    — bright, energetic
//   River (QA):         nova    — clear, precise
const OPENAI_VOICE_MAP: Record<string, string> = {
  [AGENT.PM]: "alloy",
  [AGENT.ARCHITECT]: "onyx",
  [AGENT.DEVELOPER]: "echo",
  [AGENT.QA]: "nova",
};

const DEFAULT_OPENAI_VOICE = "alloy";

// ---- Voice config resolution ----

export function getVoiceConfig(agentType: string, provider: VoiceProvider = "openai"): VoiceConfig {
  const personality = getPersonality(agentType);
  const sv = personality?.standup_voice;

  return {
    provider,
    voiceId: OPENAI_VOICE_MAP[agentType] ?? DEFAULT_OPENAI_VOICE,
    speed: sv?.speed ?? 1.0,
    pitch: sv?.pitch ?? "medium",
    accentHint: sv?.accent_hint ?? "neutral",
  };
}

// ---- Audio file management ----

function getVoiceDir(projectId: string): string {
  const dir = path.join(os.tmpdir(), "lilit", projectId, "voice");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getAudioPath(projectId: string, messageId: string): string {
  return path.join(getVoiceDir(projectId), `${messageId}.mp3`);
}

export function getAudioFilePath(projectId: string, messageId: string): string | null {
  const filePath = getAudioPath(projectId, messageId);
  if (fs.existsSync(filePath)) return filePath;
  return null;
}

// ---- Synthesis ----

/**
 * Synthesize speech for a standup message. Caches on disk by messageId.
 *
 * Returns null if the TTS provider is not configured (missing API key).
 */
export async function synthesize(opts: {
  projectId: string;
  messageId: string;
  text: string;
  agentType: string;
  provider?: VoiceProvider;
}): Promise<SynthesisResult | null> {
  const { projectId, messageId, text, agentType, provider = "openai" } = opts;

  // Check cache first
  const cached = getAudioFilePath(projectId, messageId);
  if (cached) {
    return {
      filePath: cached,
      durationMs: estimateDuration(text),
      cached: true,
    };
  }

  if (provider === "openai") {
    return synthesizeOpenAI({ projectId, messageId, text, agentType });
  }

  // Unsupported provider
  return null;
}

// ---- OpenAI TTS ----

async function synthesizeOpenAI(opts: {
  projectId: string;
  messageId: string;
  text: string;
  agentType: string;
}): Promise<SynthesisResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const config = getVoiceConfig(opts.agentType, "openai");
  const filePath = getAudioPath(opts.projectId, opts.messageId);

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      input: opts.text,
      voice: config.voiceId,
      speed: config.speed,
      response_format: "mp3",
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    throw new Error(`OpenAI TTS failed (${response.status}): ${errText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  return {
    filePath,
    durationMs: estimateDuration(opts.text),
    cached: false,
  };
}

// ---- Helpers ----

/** Rough duration estimate: ~150 words per minute at speed 1.0 */
function estimateDuration(text: string, speed = 1.0): number {
  const words = text.split(/\s+/).length;
  const minutes = words / 150 / speed;
  return Math.round(minutes * 60 * 1000);
}

/**
 * Check if voice synthesis is available (API key configured).
 */
export function isVoiceAvailable(provider: VoiceProvider = "openai"): boolean {
  if (provider === "openai") return !!process.env.OPENAI_API_KEY;
  return false;
}
