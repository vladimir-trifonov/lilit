"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAgentRegistry } from "@/lib/hooks/use-agent-registry";
import { apiFetch } from "@/lib/utils";

interface AgentsPanelProps {
  onClose: () => void;
}

export function AgentsPanel({ onClose }: AgentsPanelProps) {
  const { agents, providers, loading, refetchAgents, getModelsForProvider } = useAgentRegistry();

  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editPrompt, setEditPrompt] = useState("");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editModel, setEditModel] = useState("");
  const [editProvider, setEditProvider] = useState("");
  const [dirty, setDirty] = useState(false);

  // New agent form
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [newType, setNewType] = useState("");
  const [newName, setNewName] = useState("");

  function selectAgent(type: string, role?: string) {
    const agent = agents[type];
    if (!agent) return;

    setSelectedAgent(type);
    setSelectedRole(role ?? null);

    if (role && agent.roles[role]) {
      const r = agent.roles[role];
      setEditName(r.name);
      setEditDescription(r.description);
      setEditPrompt(r.systemPrompt);
      setEditModel(r.model ?? "");
      setEditProvider(r.provider ?? "");
    } else {
      setEditName(agent.name);
      setEditDescription(agent.description);
      setEditPrompt(agent.systemPrompt);
      setEditModel(agent.model ?? "");
      setEditProvider(agent.provider ?? "");
    }
    setDirty(false);
  }

  async function handleSave() {
    if (!selectedAgent) return;
    setSaving(true);

    try {
      const frontmatter: Record<string, unknown> = {
        name: editName,
        description: editDescription,
      };
      if (editModel) frontmatter.model = editModel;
      if (editProvider) frontmatter.provider = editProvider;

      if (selectedRole) {
        frontmatter.role = selectedRole;
        await apiFetch("/api/agents", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: selectedAgent,
            role: selectedRole,
            frontmatter,
            systemPrompt: editPrompt,
          }),
        });
      } else {
        const agent = agents[selectedAgent];
        frontmatter.type = selectedAgent;
        if (agent?.capabilities?.length) frontmatter.capabilities = agent.capabilities;
        if (agent?.tags?.length) frontmatter.tags = agent.tags;

        await apiFetch("/api/agents", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: selectedAgent,
            frontmatter,
            systemPrompt: editPrompt,
          }),
        });
      }

      setDirty(false);
      await refetchAgents();
    } catch (err) {
      console.error("Failed to save:", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateAgent() {
    if (!newType || !newName) return;
    setSaving(true);
    try {
      await apiFetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: newType,
          name: newName,
          description: "",
          provider: providers[0]?.id ?? "claude-code",
          model: providers[0]?.models[0] ?? "",
          capabilities: ["file-access", "shell-access", "tool-use"],
          tags: [],
          systemPrompt: `You are a ${newName}. Define your role here.`,
        }),
      });
      setShowNewAgent(false);
      setNewType("");
      setNewName("");
      await refetchAgents();
    } catch (err) {
      console.error("Failed to create agent:", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(type: string, role?: string) {
    if (!confirm(`Delete ${role ? `role ${role} from ${type}` : `agent ${type}`}?`)) return;

    try {
      const params = new URLSearchParams({ type });
      if (role) params.set("role", role);
      await apiFetch(`/api/agents?${params}`, { method: "DELETE" });

      if (selectedAgent === type && selectedRole === (role ?? null)) {
        setSelectedAgent(null);
        setSelectedRole(null);
      }
      await refetchAgents();
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in">
        <div className="glass raised border border-border rounded-xl p-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
        </div>
      </div>
    );
  }

  const agentEntries = Object.values(agents);
  const selected = selectedAgent ? agents[selectedAgent] : null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="glass-raised border border-border rounded-xl w-full max-w-5xl max-h-[85vh] flex flex-col shadow-2xl animate-fade-in-scale overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border-subtle shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-medium text-foreground">Agent Management</h2>
            <Badge variant="outline" className="text-xs text-muted-foreground border-border">
              {agentEntries.length} Agents
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {dirty && <Badge variant="outline" className="text-xs border-warning/50 text-warning bg-warning-soft">Unsaved Changes</Badge>}
            {dirty && (
              <Button onClick={handleSave} disabled={saving} size="sm" className="text-xs animate-pulse">
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            )}
            <Button onClick={onClose} variant="ghost" size="sm" className="text-xs">
              Close
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-1 min-h-0">
          {/* Agent list (left) */}
          <div className="w-64 border-r border-border-subtle overflow-y-auto shrink-0 bg-sidebar/50">
            <div className="p-3 space-y-1">
              {agentEntries.map((agent) => (
                <div key={agent.type}>
                  <button
                    onClick={() => selectAgent(agent.type)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                      selectedAgent === agent.type && !selectedRole
                        ? "bg-brand-soft text-brand-foreground shadow-sm"
                        : "text-foreground hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{agent.name}</span>
                      <Badge variant="secondary" className="text-[9px] bg-surface-raised/50">
                        {Object.keys(agent.roles).length} roles
                      </Badge>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 truncate opacity-70">
                      {agent.provider ?? "claude-code"} / {agent.model ?? "default"}
                    </div>
                  </button>

                  {/* Roles */}
                  <div className="ml-3 border-l border-border-subtle pl-2 space-y-0.5 mt-0.5">
                    {Object.values(agent.roles).map((role) => (
                      <button
                        key={role.role}
                        onClick={() => selectAgent(agent.type, role.role)}
                        className={`w-full text-left pl-2 pr-3 py-1.5 rounded-md text-xs transition-colors ${
                          selectedAgent === agent.type && selectedRole === role.role
                            ? "bg-brand-soft/50 text-brand-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                        }`}
                      >
                        {role.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              {/* Add Agent */}
              {showNewAgent ? (
                <div className="p-3 space-y-2 border border-border-subtle rounded-lg bg-surface/50 mt-4 animate-fade-in-up">
                  <input
                    value={newType}
                    onChange={(e) => setNewType(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    placeholder="agent-type"
                    className="w-full bg-input/50 border border-input rounded px-2 py-1.5 text-xs outline-none focus:border-brand/50 transition-colors"
                  />
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Display Name"
                    className="w-full bg-input/50 border border-input rounded px-2 py-1.5 text-xs outline-none focus:border-brand/50 transition-colors"
                  />
                  <div className="flex gap-1 pt-1">
                    <Button onClick={handleCreateAgent} size="sm" className="text-xs flex-1 h-7" disabled={!newType || !newName}>
                      Create
                    </Button>
                    <Button onClick={() => setShowNewAgent(false)} variant="ghost" size="sm" className="text-xs h-7">
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  onClick={() => setShowNewAgent(true)}
                  variant="outline"
                  size="sm"
                  className="w-full text-xs text-muted-foreground mt-4 border-dashed"
                >
                  + Add New Agent
                </Button>
              )}
            </div>
          </div>

          {/* Agent detail (right) */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-surface/30">
            {!selected ? (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                <div className="text-4xl mb-4 opacity-20">🤖</div>
                <p className="text-sm">Select an agent to configure</p>
              </div>
            ) : (
              <div className="animate-fade-in space-y-6 max-w-3xl mx-auto">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-medium text-foreground">
                      {selectedRole ? `${selected.name} / ${selectedRole}` : selected.name}
                    </h3>
                     <p className="text-xs text-muted-foreground">
                        {selectedRole ? `Configuring role` : `Configuring base agent`}
                     </p>
                  </div>
                  <Button
                    onClick={() => handleDelete(selected.type, selectedRole ?? undefined)}
                    variant="ghost"
                    size="sm"
                    className="text-xs text-destructive hover:bg-destructive-soft hover:text-destructive"
                  >
                    Delete {selectedRole ? "Role" : "Agent"}
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-6">
                   {/* Name */}
                   <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Display Name</label>
                    <input
                      value={editName}
                      onChange={(e) => { setEditName(e.target.value); setDirty(true); }}
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all"
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Description</label>
                    <input
                      value={editDescription}
                      onChange={(e) => { setEditDescription(e.target.value); setDirty(true); }}
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all"
                    />
                  </div>
                </div>

                {/* Provider & Model */}
                <div className="grid grid-cols-2 gap-6 p-4 rounded-lg border border-border-subtle bg-surface/30">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Provider</label>
                    <select
                      value={editProvider}
                      onChange={(e) => {
                        const newProvider = e.target.value;
                        setEditProvider(newProvider);
                        const models = getModelsForProvider(newProvider);
                        setEditModel(models[0] ?? "");
                        setDirty(true);
                      }}
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all"
                    >
                      <option value="">Inherit from project defaults</option>
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Model</label>
                    <select
                      value={editModel}
                      onChange={(e) => { setEditModel(e.target.value); setDirty(true); }}
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all"
                    >
                      <option value="">Inherit from provider defaults</option>
                      {(editProvider ? getModelsForProvider(editProvider) : providers.flatMap((p) => p.models)).map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Capabilities & Tags (agent only) */}
                {!selectedRole && (
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground block">Capabilities</label>
                    <div className="flex gap-2 flex-wrap p-3 rounded-lg border border-border-subtle bg-surface/30">
                      {selected.capabilities.map((c) => (
                        <Badge key={c} variant="secondary" className="text-[10px] bg-brand-soft/50 text-brand-foreground border-brand/20">{c}</Badge>
                      ))}
                      {selected.tags.map((t) => (
                        <Badge key={t} variant="outline" className="text-[10px] border-dashed">{t}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* System Prompt */}
                <div className="flex-1 flex flex-col min-h-0">
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">System Prompt</label>
                  <textarea
                    value={editPrompt}
                    onChange={(e) => { setEditPrompt(e.target.value); setDirty(true); }}
                    className="w-full flex-1 bg-surface border border-border rounded-lg px-4 py-3 text-xs font-mono resize-y outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all min-h-[300px] leading-relaxed"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1.5 text-right">
                    Markdown supported. Used to define agent behavior.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
