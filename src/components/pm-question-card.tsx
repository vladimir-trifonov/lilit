"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

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
      <p className="text-sm text-foreground">{question}</p>
      {context && (
        <p className="text-xs text-muted-foreground">{context}</p>
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
