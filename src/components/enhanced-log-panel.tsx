/**
 * Enhanced log panel with syntax highlighting, collapsible sections, and search
 */

"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { parseLogSections, formatLogLine } from "@/lib/log-highlighter";

interface EnhancedLogPanelProps {
  logContent: string;
  loading: boolean;
  currentAgent?: string | null;
}

export function EnhancedLogPanel({ logContent, loading }: EnhancedLogPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());
  const logRef = useRef<HTMLDivElement>(null);

  // Parse log into sections
  const sections = useMemo(() => parseLogSections(logContent), [logContent]);

  // Filter sections by search query
  const filteredSections = useMemo(() => {
    if (!searchQuery) return sections;

    const query = searchQuery.toLowerCase();
    return sections.filter(
      (section) =>
        section.agent.toLowerCase().includes(query) ||
        section.content.toLowerCase().includes(query)
    );
  }, [sections, searchQuery]);

  // Auto-scroll to bottom when content changes
  useEffect(() => {
    if (logRef.current && loading) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logContent, loading]);

  const toggleSection = (index: number) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const expandAll = () => setCollapsedSections(new Set());
  const collapseAll = () => setCollapsedSections(new Set(sections.map((_, i) => i)));

  const clearSearch = () => setSearchQuery("");

  if (!logContent && !loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No logs yet. Start a pipeline to see output.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b border-border shrink-0">
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search logs..."
          className="flex-1 h-8 text-xs bg-muted/50 border-input"
        />
        {searchQuery && (
          <Button
            onClick={clearSearch}
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
          >
            Clear
          </Button>
        )}
        <div className="h-4 w-px bg-border" />
        <Button
          onClick={expandAll}
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          title="Expand all sections"
        >
          Expand All
        </Button>
        <Button
          onClick={collapseAll}
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          title="Collapse all sections"
        >
          Collapse All
        </Button>
        {loading && (
          <Badge variant="outline" className="text-xs animate-pulse">
            Live
          </Badge>
        )}
      </div>

      {/* Log content */}
      <div
        ref={logRef}
        className="flex-1 overflow-auto bg-secondary/10 font-mono"
      >
        {filteredSections.length === 0 && searchQuery ? (
          <div className="p-4 text-center text-muted-foreground text-sm">
            No results for &ldquo;{searchQuery}&rdquo;
          </div>
        ) : filteredSections.length === 0 ? (
          <div className="p-4 text-muted-foreground text-xs whitespace-pre-wrap">
            {logContent || "Waiting for output..."}
          </div>
        ) : (
          <div className="space-y-2 p-2">
            {filteredSections.map((section, index) => {
              const isCollapsed = collapsedSections.has(index);
              const statusIcon =
                section.status === "running"
                  ? "🔄"
                  : section.status === "done"
                    ? "✅"
                    : "❌";

              return (
                <div
                  key={index}
                  className="border border-border rounded-lg overflow-hidden"
                >
                  {/* Section Header */}
                  <button
                    onClick={() => toggleSection(index)}
                    className="w-full flex items-center justify-between p-3 bg-muted/30 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className={section.status === "running" ? "animate-spin" : ""}>
                        {statusIcon}
                      </span>
                      <Badge
                        variant={
                          section.status === "done"
                            ? "secondary"
                            : section.status === "failed"
                              ? "destructive"
                              : "default"
                        }
                        className="text-xs"
                      >
                        {section.agent}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Lines {section.startLine}-{section.endLine}
                      </span>
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {isCollapsed ? "▶" : "▼"}
                    </span>
                  </button>

                  {/* Section Content */}
                  {!isCollapsed && (
                    <div className="p-3 bg-card max-h-96 overflow-auto">
                      <div className="text-xs text-muted-foreground space-y-1">
                        {section.content.split("\n").map((line, lineIdx) => {
                          const { html, type } = formatLogLine(line);
                          return (
                            <div
                              key={lineIdx}
                              className={`${
                                type === "separator" ? "opacity-50" : ""
                              } whitespace-pre-wrap break-words`}
                              dangerouslySetInnerHTML={{ __html: html }}
                            />
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
