/**
 * Syntax highlighting for log content
 * Simple regex-based highlighting without external dependencies
 */

export interface HighlightedSegment {
  text: string;
  type:
    | "text"
    | "keyword"
    | "string"
    | "number"
    | "comment"
    | "operator"
    | "function"
    | "error"
    | "success"
    | "warning"
    | "code-block";
}

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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect agent start: "🚀 [agent:role] Started"
    const startMatch = line.match(/🚀 \[([^\]]+)\] Started/);
    if (startMatch) {
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

    // Detect agent completion: "✅ [agent:role] Done"
    const doneMatch = line.match(/✅ \[([^\]]+)\] Done/);
    if (doneMatch && currentSection) {
      currentSection.status = "done";
      currentContent.push(line);
      continue;
    }

    // Detect agent failure: "❌ [agent:role] Failed"
    const failMatch = line.match(/❌ \[([^\]]+)\] Failed/);
    if (failMatch && currentSection) {
      currentSection.status = "failed";
      currentContent.push(line);
      continue;
    }

    // Add line to current section
    if (currentSection) {
      currentContent.push(line);
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

  return sections;
}

/**
 * Simple syntax highlighting for code blocks
 */
export function highlightCode(code: string, language?: string): string {
  // JavaScript/TypeScript patterns
  const patterns = [
    // Comments
    { pattern: /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm, className: "text-zinc-500 italic" },
    // Strings
    { pattern: /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g, className: "text-green-400" },
    // Numbers
    { pattern: /\b(\d+\.?\d*)\b/g, className: "text-purple-400" },
    // Keywords
    { pattern: /\b(const|let|var|function|class|if|else|return|import|export|from|async|await|try|catch|throw|new|typeof|instanceof)\b/g, className: "text-blue-400 font-medium" },
    // Functions
    { pattern: /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g, className: "text-yellow-400" },
    // Operators
    { pattern: /(=>|===|!==|==|!=|<=|>=|&&|\|\||[+\-*/%=<>!])/g, className: "text-cyan-400" },
  ];

  let highlighted = code;

  // Escape HTML first
  highlighted = highlighted
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Apply patterns
  for (const { pattern, className } of patterns) {
    highlighted = highlighted.replace(pattern, (match) => {
      return `<span class="${className}">${match}</span>`;
    });
  }

  return highlighted;
}

/**
 * Detect if a block of text is code
 */
export function isCodeBlock(text: string): boolean {
  // Check for code indicators
  const codeIndicators = [
    /```/,  // Markdown code fence
    /^\s*function\s+\w+/m,  // Function declaration
    /^\s*const\s+\w+/m,  // Const declaration
    /^\s*import\s+/m,  // Import statement
    /^\s*export\s+/m,  // Export statement
    /^\s*class\s+\w+/m,  // Class declaration
    /^\s*interface\s+\w+/m,  // Interface declaration
    /^\s*type\s+\w+/m,  // Type declaration
    /{\s*[\w]+:\s*[\w"'`]/,  // Object literal
  ];

  return codeIndicators.some((pattern) => pattern.test(text));
}

/**
 * Format log line with color coding
 */
export function formatLogLine(line: string): { html: string; type: string } {
  // Error lines
  if (line.includes("❌") || line.includes("ERROR") || line.toLowerCase().includes("error:")) {
    return { html: `<span class="text-red-400">${escapeHtml(line)}</span>`, type: "error" };
  }

  // Success lines
  if (line.includes("✅") || line.includes("SUCCESS")) {
    return { html: `<span class="text-green-400">${escapeHtml(line)}</span>`, type: "success" };
  }

  // Warning lines
  if (line.includes("⚠️") || line.includes("WARNING") || line.includes("WARN")) {
    return { html: `<span class="text-yellow-400">${escapeHtml(line)}</span>`, type: "warning" };
  }

  // Info lines (headers, separators)
  if (line.includes("=".repeat(10)) || line.includes("─".repeat(10))) {
    return { html: `<span class="text-zinc-600">${escapeHtml(line)}</span>`, type: "separator" };
  }

  // Agent labels
  if (line.match(/^\[[\w:]+\]/)) {
    return { html: `<span class="text-blue-400 font-medium">${escapeHtml(line)}</span>`, type: "label" };
  }

  // Default
  return { html: escapeHtml(line), type: "text" };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
