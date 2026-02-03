"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useProviderStatus } from "@/lib/hooks/use-provider-status";

export function ProviderAlert() {
  const [dismissed, setDismissed] = useState(false);
  const { providers, unavailable, anyAvailable, recheck } = useProviderStatus();

  // Auto-hide when at least one provider becomes available
  if (!providers || anyAvailable) return null;
  if (dismissed) return null;

  return (
    <div className="bg-warning-soft border-b border-warning/20 px-4 py-3 text-sm animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-warning flex items-center gap-2">
            <span>⚠</span> No AI providers available
          </p>
          <ul className="mt-1 space-y-0.5 text-warning/80 text-xs">
            {unavailable.map((p) => (
              <li key={p.id}>
                {p.name}: {p.reason ?? "unavailable"}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs border-warning/50 text-warning hover:bg-warning-soft hover:text-warning"
            onClick={() => recheck()}
          >
            Recheck
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-warning/70 hover:text-warning hover:bg-warning-soft"
            onClick={() => setDismissed(true)}
          >
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}
