"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/utils";

interface ProviderInfo {
  id: string;
  name: string;
  available: boolean;
  models: string[];
}

interface RoleDefinition {
  role: string;
  name: string;
  description: string;
  provider?: string;
  model?: string;
  systemPrompt: string;
}

interface AgentDefinition {
  type: string;
  name: string;
  description: string;
  provider?: string;
  model?: string;
  capabilities: string[];
  tags: string[];
  systemPrompt: string;
  roles: Record<string, RoleDefinition>;
}

export interface UseAgentRegistryResult {
  agents: Record<string, AgentDefinition>;
  providers: ProviderInfo[];
  loading: boolean;
  refetchAgents: () => Promise<void>;
  getModelsForProvider: (providerId: string) => string[];
}

/**
 * Loads agent definitions and available providers in parallel.
 * Provides a helper to resolve models for a given provider.
 */
export function useAgentRegistry(): UseAgentRegistryResult {
  const [agents, setAgents] = useState<Record<string, AgentDefinition>>({});
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await apiFetch("/api/agents");
      const data = await res.json();
      if (mountedRef.current) setAgents(data.agents || {});
    } catch (err) {
      console.error("Failed to fetch agents:", err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [agentsRes, providersRes] = await Promise.all([
          apiFetch("/api/agents"),
          apiFetch("/api/providers"),
        ]);

        const [agentsData, providersData] = await Promise.all([
          agentsRes.json(),
          providersRes.json(),
        ]);

        if (!cancelled) {
          setAgents(agentsData.agents || {});
          setProviders(
            ((providersData.providers ?? []) as ProviderInfo[]).filter(
              (p) => p.available,
            ),
          );
        }
      } catch (err) {
        console.error("Failed to load agent registry:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const getModelsForProvider = useCallback(
    (providerId: string): string[] => {
      const p = providers.find((pr) => pr.id === providerId);
      return p?.models ?? [];
    },
    [providers],
  );

  return { agents, providers, loading, refetchAgents: fetchAgents, getModelsForProvider };
}
