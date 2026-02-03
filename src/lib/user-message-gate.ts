/**
 * User message gate — file-based polling for mid-execution communication.
 *
 * Same pattern as plan-gate.ts: worker writes/reads files, API route writes files.
 *
 * - User messages: queued by /api/chat when a pipeline is running
 * - PM questions: written by the decision loop when PM asks the user something
 */

import fs from "fs";
import path from "path";
import { getProjectDir } from "@/lib/claude-code";
import {
  USER_MESSAGE_FILE_PREFIX,
  PM_QUESTION_FILE_PREFIX,
  PM_QUESTION_TIMEOUT_MS,
  USER_MESSAGE_POLL_INTERVAL_MS,
} from "@/lib/constants";

// ── User messages (user → pipeline) ────────────────────────────────────────

/**
 * Write a user message file for the running pipeline to pick up.
 */
export function writeUserMessage(
  projectId: string,
  runId: string,
  message: string,
) {
  const dir = getProjectDir(projectId);
  const filename = `${USER_MESSAGE_FILE_PREFIX}${runId}-${Date.now()}.json`;
  const data = JSON.stringify({ message, createdAt: Date.now() });
  fs.writeFileSync(path.join(dir, filename), data, "utf-8");
}

/**
 * Non-blocking scan for user messages. Returns messages and deletes the files.
 */
export function checkForUserMessages(
  projectId: string,
  runId: string,
): string[] {
  const messages: string[] = [];
  try {
    const dir = getProjectDir(projectId);
    const prefix = `${USER_MESSAGE_FILE_PREFIX}${runId}-`;
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
      .sort(); // chronological by timestamp in filename

    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        if (data.message) {
          messages.push(data.message);
        }
        fs.unlinkSync(filePath);
      } catch {
        // Skip corrupted files
        try {
          fs.unlinkSync(filePath);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // Directory doesn't exist yet — no messages
  }
  return messages;
}

// ── PM questions (pipeline → user) ─────────────────────────────────────────

export interface PMQuestion {
  question: string;
  context: string;
  createdAt: number;
}

export interface PMQuestionAnswer {
  answer: string;
  answeredAt: number;
}

function questionFilePath(projectId: string, runId: string): string {
  return path.join(
    getProjectDir(projectId),
    `${PM_QUESTION_FILE_PREFIX}${runId}.json`,
  );
}

function answerFilePath(projectId: string, runId: string): string {
  return path.join(
    getProjectDir(projectId),
    `${PM_QUESTION_FILE_PREFIX}${runId}-answer.json`,
  );
}

/**
 * Write a PM question file for the UI to display.
 */
export function writePMQuestion(
  projectId: string,
  runId: string,
  question: string,
  context: string,
) {
  const data: PMQuestion = { question, context, createdAt: Date.now() };
  fs.writeFileSync(questionFilePath(projectId, runId), JSON.stringify(data), "utf-8");
}

/**
 * Read the pending PM question (used by API route).
 */
export function readPMQuestion(
  projectId: string,
  runId: string,
): PMQuestion | null {
  const fp = questionFilePath(projectId, runId);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Write user's answer to the PM question (called by API route).
 */
export function writePMQuestionAnswer(
  projectId: string,
  runId: string,
  answer: string,
) {
  const data: PMQuestionAnswer = { answer, answeredAt: Date.now() };
  fs.writeFileSync(answerFilePath(projectId, runId), JSON.stringify(data), "utf-8");
}

/**
 * Wait for user response to a PM question — polls filesystem.
 */
export async function waitForUserResponse(
  projectId: string,
  runId: string,
  opts?: {
    timeoutMs?: number;
    abortCheck?: () => boolean;
  },
): Promise<string | null> {
  const timeout = opts?.timeoutMs ?? PM_QUESTION_TIMEOUT_MS;
  const abortCheck = opts?.abortCheck ?? (() => false);
  const start = Date.now();
  const fp = answerFilePath(projectId, runId);

  return new Promise<string | null>((resolve) => {
    const check = () => {
      if (abortCheck()) {
        resolve(null);
        return;
      }

      if (fs.existsSync(fp)) {
        try {
          const data = JSON.parse(
            fs.readFileSync(fp, "utf-8"),
          ) as PMQuestionAnswer;
          // Clean up both files
          try {
            fs.unlinkSync(questionFilePath(projectId, runId));
          } catch {
            // ignore
          }
          try {
            fs.unlinkSync(fp);
          } catch {
            // ignore
          }
          resolve(data.answer);
          return;
        } catch {
          // Corrupt file, keep polling
        }
      }

      if (Date.now() - start > timeout) {
        // Clean up question file on timeout
        try {
          fs.unlinkSync(questionFilePath(projectId, runId));
        } catch {
          // ignore
        }
        resolve(null);
        return;
      }

      setTimeout(check, USER_MESSAGE_POLL_INTERVAL_MS);
    };

    check();
  });
}

/**
 * Clean up any lingering question/answer files.
 */
export function cleanupQuestionFiles(projectId: string, runId: string) {
  try {
    fs.unlinkSync(questionFilePath(projectId, runId));
  } catch {
    // ignore
  }
  try {
    fs.unlinkSync(answerFilePath(projectId, runId));
  } catch {
    // ignore
  }
}
