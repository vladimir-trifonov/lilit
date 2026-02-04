"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import ReactMarkdown from "react-markdown";

interface PMQuestionCardProps {
  question: string;
  context: string;
  onAnswer: (answer: string) => Promise<void>;
}

export function PMQuestionCard({ question, context, onAnswer }: PMQuestionCardProps) {
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!answer.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onAnswer(answer.trim());
      setAnswer("");
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="glass border border-info/30 rounded-xl p-4 space-y-3 animate-fade-in">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "oklch(0.65 0.15 270)" }}>
          <span className="text-[10px] text-white font-bold">S</span>
        </div>
        <span className="text-xs font-semibold text-info">Sasha needs your input</span>
      </div>
      <div className="text-sm text-foreground break-words leading-relaxed">
        <ReactMarkdown
          components={{
            h1: ({ children }) => <h3 className="text-sm font-bold text-foreground mt-2 mb-1 first:mt-0">{children}</h3>,
            h2: ({ children }) => <h3 className="text-sm font-bold text-foreground mt-2 mb-1 first:mt-0">{children}</h3>,
            h3: ({ children }) => <h4 className="text-[13px] font-semibold text-foreground mt-2 mb-1 first:mt-0">{children}</h4>,
            p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
            strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
            ul: ({ children }) => <ul className="mb-1.5 last:mb-0 space-y-0.5 pl-4 list-disc marker:text-info/50">{children}</ul>,
            ol: ({ children }) => <ol className="mb-1.5 last:mb-0 space-y-0.5 pl-4 list-decimal marker:text-info/50">{children}</ol>,
            li: ({ children }) => <li className="text-sm pl-0.5">{children}</li>,
            code: ({ children }) => <code className="text-xs font-mono bg-surface/80 px-1 py-0.5 rounded border border-border-subtle text-info">{children}</code>,
          }}
        >
          {question}
        </ReactMarkdown>
      </div>
      {context && (
        <div className="text-xs text-muted-foreground break-words leading-relaxed">
          <ReactMarkdown
            components={{
              p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
              strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
              ul: ({ children }) => <ul className="mb-1 last:mb-0 space-y-0.5 pl-3 list-disc marker:text-muted-foreground/50">{children}</ul>,
              ol: ({ children }) => <ol className="mb-1 last:mb-0 space-y-0.5 pl-3 list-decimal marker:text-muted-foreground/50">{children}</ol>,
              li: ({ children }) => <li className="text-xs pl-0.5">{children}</li>,
              code: ({ children }) => <code className="text-[11px] font-mono bg-surface/80 px-1 py-0.5 rounded">{children}</code>,
            }}
          >
            {context}
          </ReactMarkdown>
        </div>
      )}
      <div className="flex gap-2">
        <Textarea
          placeholder="Type your answer..."
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          className="bg-surface/50 border-border resize-none min-h-[36px] text-sm"
          disabled={submitting}
        />
        <Button
          onClick={handleSubmit}
          disabled={!answer.trim() || submitting}
          size="sm"
          className="self-end"
        >
          {submitting ? "..." : "Reply"}
        </Button>
      </div>
    </div>
  );
}
