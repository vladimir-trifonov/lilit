/**
 * Syntax highlighting for log content
 * Simple regex-based highlighting without external dependencies
 */

import { LOG_SEPARATOR_DETECT_LENGTH } from "@/lib/constants";

/**
 * Parse log content into sections by agent
 */
export interface LogSection {
  agent: string;
  header: string;
  content: string;
  startLine: number;
  endLine: number;
  status: "running" | "done" | "failed";
}

export function parseLogSections(logContent: string): LogSection[] {
  const lines = logContent.split("\n");
  const sections: LogSection[] = [];
  let currentSection: Partial<LogSection> | null = null;
  let currentContent: string[] = [];
  const preContent: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect pipeline abort: mark all running sections as failed
    if (line.includes("🛑 PIPELINE ABORTED")) {
      if (currentSection) {
        if (currentSection.status === "running") currentSection.status = "failed";
        currentContent.push(line);
      }
      // Mark any previously saved running sections as failed
      for (const s of sections) {
        if (s.status === "running") s.status = "failed";
      }
      continue;
    }

    // Detect agent start: "🚀 [agent:role] Started"
    const startMatch = line.match(/🚀 \[([^\]]+)\] Started/);
    if (startMatch) {
      // Save pre-section content as a "Pipeline" section
      if (!currentSection && preContent.length > 0) {
        const trimmed = preContent.join("\n").trim();
        if (trimmed) {
          sections.push({
            agent: "pipeline",
            header: "Pipeline",
            content: trimmed,
            startLine: 0,
            endLine: i - 1,
            status: "done",
          });
        }
      }

      // Save previous section
      if (currentSection) {
        sections.push({
          ...currentSection,
          content: currentContent.join("\n"),
          endLine: i - 1,
          status: currentSection.status || "done",
        } as LogSection);
      }

      // Start new section
      currentSection = {
        agent: startMatch[1],
        header: line,
        startLine: i,
        status: "running",
      };
      currentContent = [];
      continue;
    }

    // Detect agent completion: "[agent:role] Done" or "✅ [agent:role] Done"
    const doneMatch = line.match(/(?:✅ )?\[([^\]]+)\] Done/);
    if (doneMatch && currentSection) {
      currentSection.status = "done";
      currentContent.push(line);
      continue;
    }

    // Detect agent failure: "[agent:role] Failed" (with or without emoji prefix)
    const failMatch = line.match(/(?:❌ |🛑 )?\[([^\]]+)\] (?:Failed|Aborted)/);
    if (failMatch && currentSection) {
      currentSection.status = "failed";
      currentContent.push(line);
      continue;
    }

    // Add line to current section or pre-section buffer
    if (currentSection) {
      currentContent.push(line);
    } else {
      preContent.push(line);
    }
  }

  // Save last section
  if (currentSection) {
    sections.push({
      ...currentSection,
      content: currentContent.join("\n"),
      endLine: lines.length - 1,
      status: currentSection.status || "done",
    } as LogSection);
  }

  // If no agent sections were found, put everything in a single pipeline section
  if (sections.length === 0 && preContent.length > 0) {
    const trimmed = preContent.join("\n").trim();
    if (trimmed) {
      sections.push({
        agent: "pipeline",
        header: "Pipeline",
        content: trimmed,
        startLine: 0,
        endLine: lines.length - 1,
        status: "running",
      });
    }
  }

  return sections;
}


/**
 * Classify a log line — returns the plain text and a CSS class for styling.
 * No HTML escaping; the component renders via React elements.
 */
export function formatLogLine(line: string): { text: string; className: string; type: string } {
  // Error lines
  if (line.includes("❌") || line.includes("ERROR") || line.toLowerCase().includes("error:")) {
    return { text: line, className: "text-red-400", type: "error" };
  }

  // Success lines
  if (line.includes("✅") || line.includes("SUCCESS")) {
    return { text: line, className: "text-green-400", type: "success" };
  }

  // Warning lines
  if (line.includes("\u26A0\uFE0F") || line.includes("WARNING") || line.includes("WARN")) {
    return { text: line, className: "text-yellow-400", type: "warning" };
  }

  // Debate lines
  if (line.includes("\uD83D\uDCAC DEBATE:")) {
    return { text: line, className: "text-red-400 font-semibold", type: "debate" };
  }
  if (line.match(/^\s+\[[\w]+\] \((?:challenge|counter|concede|escalate|moderate)\):/)) {
    return { text: line, className: "text-orange-400 pl-4", type: "debate-turn" };
  }
  if (line.match(/^\s+Outcome:/)) {
    return { text: line, className: "text-orange-300 font-medium", type: "debate-outcome" };
  }
  if (line.match(/^\s+Opinion:/)) {
    return { text: line, className: "text-red-300/80 italic", type: "debate-opinion" };
  }

  // Info lines (headers, separators)
  if (line.includes("=".repeat(LOG_SEPARATOR_DETECT_LENGTH)) || line.includes("─".repeat(LOG_SEPARATOR_DETECT_LENGTH))) {
    return { text: line, className: "text-zinc-600", type: "separator" };
  }

  // Agent labels
  if (line.match(/^\[[\w:]+\]/)) {
    return { text: line, className: "text-blue-400 font-medium", type: "label" };
  }

  // Default
  return { text: line, className: "", type: "text" };
}
