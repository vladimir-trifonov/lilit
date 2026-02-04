/**
 * Antigravity provider settings (accounts management UI)
 */

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useFetchJson } from "@/lib/hooks/use-fetch-json";
import { apiFetch } from "@/lib/utils";

interface AntigravityAccount {
  id: string;
  email: string;
  source: string;
  disabled: boolean;
  rateLimitedUntil: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

interface AntigravityStats {
  total: number;
  available: number;
  rateLimited: number;
  disabled: number;
}

interface AntigravityData {
  accounts: AntigravityAccount[];
  stats: AntigravityStats;
}

export function AntigravitySettings() {
  const { data: agData, refetch: refetchAg } = useFetchJson<AntigravityData>("/api/antigravity");
  const [agImporting, setAgImporting] = useState(false);

  const handleImportOpenCode = async () => {
    setAgImporting(true);
    try {
      await apiFetch("/api/antigravity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import" }),
      });
      await refetchAg();
    } finally {
      setAgImporting(false);
    }
  };

  const handleToggleAccount = async (id: string, disabled: boolean) => {
    await apiFetch("/api/antigravity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle", id, disabled }),
    });
    await refetchAg();
  };

  const handleRemoveAccount = async (id: string) => {
    await apiFetch(`/api/antigravity?id=${id}`, { method: "DELETE" });
    await refetchAg();
  };

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium text-foreground flex items-center gap-2">
        <span>Antigravity Accounts</span>
        {agData?.stats && (
          <span className="text-xs font-normal text-muted-foreground">
            ({agData.stats.available} available / {agData.stats.total} total)
          </span>
        )}
      </label>

      {/* Account List */}
      {agData?.accounts && agData.accounts.length > 0 ? (
        <div className="space-y-2">
          {agData.accounts.map((acct) => {
            const isRateLimited = acct.rateLimitedUntil && new Date(acct.rateLimitedUntil) > new Date();
            return (
              <div
                key={acct.id}
                className="flex items-center justify-between bg-surface border border-border-subtle rounded-lg px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      acct.disabled ? "bg-muted-foreground/30" : isRateLimited ? "bg-warning" : "bg-emerald-500"
                    }`}
                  />
                  <span className="text-sm text-foreground truncate">{acct.email}</span>
                  <Badge variant="outline" className="text-[9px] shrink-0">
                    {acct.source}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <Button
                    onClick={() => handleToggleAccount(acct.id, !acct.disabled)}
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[10px] px-2"
                  >
                    {acct.disabled ? "Enable" : "Disable"}
                  </Button>
                  <Button
                    onClick={() => handleRemoveAccount(acct.id)}
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[10px] px-2 text-destructive hover:text-destructive"
                  >
                    Remove
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground/80 bg-surface/50 p-3 rounded-lg border border-border-subtle">
          No Antigravity accounts connected. Connect a Google account or import from OpenCode to access free Gemini and Claude models.
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          onClick={() => window.open("/api/antigravity/auth", "_self")}
          variant="outline"
          size="sm"
          className="text-xs"
        >
          Connect Google Account
        </Button>
        <Button
          onClick={handleImportOpenCode}
          variant="outline"
          size="sm"
          className="text-xs"
          disabled={agImporting}
        >
          {agImporting ? "Importing..." : "Import from OpenCode"}
        </Button>
      </div>
    </div>
  );
}