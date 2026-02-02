"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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

interface AgentsPanelProps {
  onClose: () => void;
}

export function AgentsPanel({ onClose }: AgentsPanelProps) {
  const [agents, setAgents] = useState<Record<string, AgentDefinition>>({});
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    fetchAgents();
  }, []);

  async function fetchAgents() {
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      setAgents(data.agents || {});
    } catch (err) {
      console.error("Failed to fetch agents:", err);
    } finally {
      setLoading(false);
    }
  }

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
        await fetch("/api/agents", {
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

        await fetch("/api/agents", {
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
      await fetchAgents();
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
      await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: newType,
          name: newName,
          description: "",
          provider: "claude-code",
          model: "sonnet",
          capabilities: ["file-access", "shell-access", "tool-use"],
          tags: [],
          systemPrompt: `You are a ${newName}. Define your role here.`,
        }),
      });
      setShowNewAgent(false);
      setNewType("");
      setNewName("");
      await fetchAgents();
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
      await fetch(`/api/agents?${params}`, { method: "DELETE" });

      if (selectedAgent === type && selectedRole === (role ?? null)) {
        setSelectedAgent(null);
        setSelectedRole(null);
      }
      await fetchAgents();
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8">
          <div className="animate-spin text-2xl">⟳</div>
        </div>
      </div>
    );
  }

  const agentEntries = Object.values(agents);
  const selected = selectedAgent ? agents[selectedAgent] : null;

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border rounded-xl w-full max-w-5xl max-h-[85vh] flex flex-col shadow-2xl animate-fade-in-scale">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h2 className="text-lg font-medium text-foreground">Agent Management</h2>
          <div className="flex items-center gap-2">
            {dirty && <Badge variant="outline" className="text-xs border-destructive/50 text-destructive">Unsaved</Badge>}
            {dirty && (
              <Button onClick={handleSave} disabled={saving} size="sm" className="text-xs">
                {saving ? "Saving..." : "Save"}
              </Button>
            )}
            <Button onClick={onClose} variant="ghost" size="sm" className="text-xs">
              Close
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Agent list (left) */}
          <div className="w-64 border-r border-border overflow-y-auto shrink-0">
            <div className="p-3 space-y-1">
              {agentEntries.map((agent) => (
                <div key={agent.type}>
                  <button
                    onClick={() => selectAgent(agent.type)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      selectedAgent === agent.type && !selectedRole
                        ? "bg-primary/10 text-primary"
                        : "text-foreground hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{agent.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {Object.keys(agent.roles).length} roles
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {agent.provider ?? "claude-code"} / {agent.model ?? "sonnet"}
                    </div>
                  </button>

                  {/* Roles */}
                  {Object.values(agent.roles).map((role) => (
                    <button
                      key={role.role}
                      onClick={() => selectAgent(agent.type, role.role)}
                      className={`w-full text-left pl-8 pr-3 py-1.5 rounded-md text-xs transition-colors ${
                        selectedAgent === agent.type && selectedRole === role.role
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted/50"
                      }`}
                    >
                      {role.name}
                    </button>
                  ))}
                </div>
              ))}

              {/* Add Agent */}
              {showNewAgent ? (
                <div className="p-2 space-y-2 border border-border rounded-md">
                  <input
                    value={newType}
                    onChange={(e) => setNewType(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    placeholder="type (e.g. designer)"
                    className="w-full bg-muted/30 border border-input rounded px-2 py-1 text-xs outline-none"
                  />
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Display Name"
                    className="w-full bg-muted/30 border border-input rounded px-2 py-1 text-xs outline-none"
                  />
                  <div className="flex gap-1">
                    <Button onClick={handleCreateAgent} size="sm" className="text-xs flex-1" disabled={!newType || !newName}>
                      Create
                    </Button>
                    <Button onClick={() => setShowNewAgent(false)} variant="ghost" size="sm" className="text-xs">
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  onClick={() => setShowNewAgent(true)}
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-muted-foreground"
                >
                  + Add Agent
                </Button>
              )}
            </div>
          </div>

          {/* Agent detail (right) */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {!selected ? (
              <div className="text-center text-muted-foreground py-20">
                <p className="text-sm">Select an agent to view/edit</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-foreground">
                    {selectedRole ? `${selected.name} / ${selectedRole}` : selected.name}
                  </h3>
                  <Button
                    onClick={() => handleDelete(selected.type, selectedRole ?? undefined)}
                    variant="ghost"
                    size="sm"
                    className="text-xs text-destructive"
                  >
                    Delete
                  </Button>
                </div>

                {/* Name */}
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Name</label>
                  <input
                    value={editName}
                    onChange={(e) => { setEditName(e.target.value); setDirty(true); }}
                    className="w-full bg-muted/30 border border-input rounded-md px-3 py-1.5 text-sm outline-none"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Description</label>
                  <input
                    value={editDescription}
                    onChange={(e) => { setEditDescription(e.target.value); setDirty(true); }}
                    className="w-full bg-muted/30 border border-input rounded-md px-3 py-1.5 text-sm outline-none"
                  />
                </div>

                {/* Provider & Model */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Provider</label>
                    <select
                      value={editProvider}
                      onChange={(e) => { setEditProvider(e.target.value); setDirty(true); }}
                      className="w-full bg-muted/30 border border-input rounded-md px-3 py-1.5 text-sm outline-none"
                    >
                      <option value="">Inherit from parent</option>
                      <option value="claude-code">Claude Code CLI</option>
                      <option value="gemini">Google Gemini</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Model</label>
                    <input
                      value={editModel}
                      onChange={(e) => { setEditModel(e.target.value); setDirty(true); }}
                      placeholder="Inherit from parent"
                      className="w-full bg-muted/30 border border-input rounded-md px-3 py-1.5 text-sm outline-none"
                    />
                  </div>
                </div>

                {/* Capabilities & Tags (agent only) */}
                {!selectedRole && (
                  <div className="flex gap-2 flex-wrap">
                    {selected.capabilities.map((c) => (
                      <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>
                    ))}
                    {selected.tags.map((t) => (
                      <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                    ))}
                  </div>
                )}

                {/* System Prompt */}
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">System Prompt</label>
                  <textarea
                    value={editPrompt}
                    onChange={(e) => { setEditPrompt(e.target.value); setDirty(true); }}
                    className="w-full bg-muted/30 border border-input rounded-md px-3 py-2 text-xs font-mono resize-none outline-none min-h-[300px]"
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
