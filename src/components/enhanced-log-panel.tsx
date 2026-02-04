/**
 * Enhanced log panel with syntax highlighting, collapsible sections, and search
 */

"use client";

import React, { useState, useEffect, useRef, useMemo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { parseLogSections, formatLogLine } from "@/lib/log-highlighter";
import { useCollapsibleSections } from "@/lib/hooks/use-collapsible-sections";
import { useSearch } from "@/lib/hooks/use-search";
import { jsonToPlainText } from "json-to-plain-text";

type LineChunk =
  | { type: "text"; line: string }
  | { type: "json"; raw: string; formatted: string; plainText: string | null };

/** Merge contiguous lines that form JSON objects/arrays into single chunks. */
function chunkLines(lines: string[]): LineChunk[] {
  const chunks: LineChunk[] = [];
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      // Accumulate lines until the JSON block closes (brace counting)
      let depth = 0;
      let j = i;
      const jsonLines: string[] = [];
      while (j < lines.length) {
        const line = lines[j];
        jsonLines.push(line);
        for (const ch of line) {
          if (ch === "{" || ch === "[") depth++;
          else if (ch === "}" || ch === "]") depth--;
        }
        j++;
        if (depth <= 0) break;
      }
      const raw = jsonLines.join("\n");
      try {
        const parsed = JSON.parse(raw);
        let plainText: string | null = null;
        try {
          plainText = jsonToPlainText(parsed, { seperator: ":", spacing: true });
        } catch {
          // plain text conversion failed — will fall back to JSON view
        }
        chunks.push({ type: "json", raw, formatted: JSON.stringify(parsed, null, 2), plainText });
        i = j;
        continue;
      } catch {
        // Not valid JSON — fall through to text
      }
    }
    chunks.push({ type: "text", line: lines[i] });
    i++;
  }
  return chunks;
}

function DataBlock({ plainText, formatted, searchQuery }: { plainText: string | null; formatted: string; searchQuery: string }) {
  const [expanded, setExpanded] = useState(false);
  const [showJson, setShowJson] = useState(!plainText);
  const displayText = showJson ? formatted : (plainText ?? formatted);
  const preview = displayText.split("\n").slice(0, 6).join("\n");
  const isLong = displayText.split("\n").length > 6;

  return (
    <div className="my-1.5 rounded-md border border-border-subtle overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="text-[10px] text-brand font-mono font-medium">{showJson ? "JSON" : "DATA"}</span>
        {plainText && (
          <button
            onClick={() => setShowJson(!showJson)}
            className="text-[9px] text-faint hover:text-muted-foreground transition-colors"
          >
            {showJson ? "Text" : "JSON"}
          </button>
        )}
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[9px] text-faint hover:text-muted-foreground transition-colors ml-auto"
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        )}
      </div>
      <pre className="px-3 py-2 text-[10px] leading-relaxed overflow-x-auto text-muted-foreground/90 border-t border-border-subtle">
        {searchQuery
          ? highlightText(expanded || !isLong ? displayText : preview + "\n  ...", searchQuery)
          : (expanded || !isLong ? displayText : preview + "\n  ...")}
      </pre>
    </div>
  );
}


/** Split text on search matches and return React elements with <mark> highlights */
function highlightText(text: string, query: string): ReactNode {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    regex.test(part)
      ? React.createElement("mark", { key: i, className: "bg-warning/40 text-foreground rounded-sm px-0.5" }, part)
      : part
  );
}

interface EnhancedLogPanelProps {
  logContent: string;
  loading: boolean;
  currentAgent?: string | null;
}

export function EnhancedLogPanel({ logContent, loading }: EnhancedLogPanelProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);

  // Parse log into sections, then override "running" status when pipeline is not loading
  const sections = useMemo(() => {
    const parsed = parseLogSections(logContent);
    if (!loading) {
      for (const s of parsed) {
        if (s.status === "running") s.status = "done";
      }
    }
    return parsed;
  }, [logContent, loading]);

  // Search + filter
  const { query: searchQuery, setQuery: setSearchQuery, filtered: filteredSections, clear: clearSearch } = useSearch(
    sections,
    (section, q) =>
      section.agent.toLowerCase().includes(q.toLowerCase()) ||
      section.content.toLowerCase().includes(q.toLowerCase()),
  );

  // Collapsible sections
  const { collapsed: collapsedSections, toggle: toggleSection, expandAll, collapseAll } =
    useCollapsibleSections(sections.length);

  // Auto-scroll to bottom when content changes (during live pipeline)
  // or on first hydration (page refresh with completed pipeline)
  useEffect(() => {
    if (!logRef.current) return;
    if (loading) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    } else if (!didInitialScroll.current && logContent) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
      didInitialScroll.current = true;
    }
  }, [logContent, loading]);

  if (!logContent && !loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-xs font-mono">
        No logs yet. Start a pipeline to see output.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b border-border-subtle shrink-0 glass-subtle">
        <div className="relative flex-1">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search logs..."
            className="h-7 text-[11px] bg-surface/50 border-input pl-2 pr-7 focus-visible:ring-1 focus-visible:border-brand/50"
          />
          {searchQuery && (
            <button
              onClick={clearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          )}
        </div>

        <div className="h-4 w-px bg-border-subtle" />

        <div className="flex items-center gap-1">
          <Button
            onClick={expandAll}
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[10px] text-muted-foreground hover:text-foreground hover:bg-surface"
            title="Expand all sections"
          >
            Expand
          </Button>
          <Button
            onClick={collapseAll}
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[10px] text-muted-foreground hover:text-foreground hover:bg-surface"
            title="Collapse all sections"
          >
            Collapse
          </Button>
        </div>

        {loading && (
          <Badge variant="outline" className="text-[9px] px-1.5 h-5 border-brand/30 text-brand bg-brand-soft/20 animate-pulse">
            Live
          </Badge>
        )}
      </div>

      {/* Log content */}
      <div
        ref={logRef}
        className="flex-1 overflow-auto p-4 space-y-3 font-mono text-xs"
      >
        {filteredSections.length === 0 && searchQuery ? (
          <div className="p-4 text-center text-muted-foreground text-xs">
            No results for &ldquo;{searchQuery}&rdquo;
          </div>
        ) : filteredSections.length === 0 ? (
          logContent ? (
            <div className="text-muted-foreground/50 text-xs whitespace-pre-wrap">
              {logContent}
            </div>
          ) : null
        ) : (
          <div className="space-y-2">
            {filteredSections.map((section, index) => {
              const isCollapsed = collapsedSections.has(index);
              const statusIcon =
                section.status === "running"
                  ? "🔄"
                  : section.status === "done"
                    ? "✅"
                    : "❌";

              const headerColor =
                section.status === "running" ? "bg-brand-soft/10 border-brand/20" :
                section.status === "failed" ? "bg-destructive-soft/10 border-destructive/20" :
                "bg-surface/40 border-border-subtle";

              return (
                <div
                  key={index}
                  className={`rounded-lg border overflow-hidden transition-all duration-200 ${headerColor}`}
                >
                  {/* Section Header */}
                  <button
                    onClick={() => toggleSection(index)}
                    className="w-full flex items-center justify-between p-2 hover:bg-surface-raised/30 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2.5 overflow-hidden">
                      {section.status === "running" ? (
                        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand border-t-transparent shrink-0" />
                      ) : (
                        <span className="shrink-0 opacity-80">{statusIcon}</span>
                      )}

                      <Badge
                        variant="secondary"
                        className={`text-[10px] px-1.5 h-5 font-normal tracking-wide ${
                          section.status === "done" ? "bg-surface-raised text-muted-foreground border-transparent" :
                          section.status === "failed" ? "bg-destructive-soft text-destructive border-transparent" :
                          "bg-brand text-white border-transparent"
                        }`}
                      >
                        {section.agent}
                      </Badge>

                      <span className="text-[10px] text-muted-foreground/60 truncate">
                        L{section.startLine}-{section.endLine}
                      </span>
                    </div>
                    <span className="text-muted-foreground/40 text-[10px] ml-2">
                      {isCollapsed ? "Show" : "Hide"}
                    </span>
                  </button>

                  {/* Section Content */}
                  {!isCollapsed && (
                    <div className="p-3 border-t border-border-subtle overflow-x-auto">
                      <div className="text-[11px] leading-relaxed text-muted-foreground/90 space-y-0.5">
                        {chunkLines(section.content.split("\n")).map((chunk, chunkIdx) => {
                          if (chunk.type === "json") {
                            return <DataBlock key={chunkIdx} plainText={chunk.plainText} formatted={chunk.formatted} searchQuery={searchQuery} />;
                          }
                          const { text, className, type } = formatLogLine(chunk.line);
                          if (!chunk.line.trim()) return null;
                          return (
                            <div
                              key={chunkIdx}
                              className={`${
                                type === "separator" ? "opacity-30 my-2" : ""
                              } whitespace-pre-wrap break-words`}
                            >
                              <span className={className}>
                                {searchQuery ? highlightText(text, searchQuery) : text}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
