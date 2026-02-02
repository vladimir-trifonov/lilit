# Product Requirements Document: Agent Standups & Inter-Agent Communication

**Version:** 1.0
**Last Updated:** 2026-02-02
**Document Owner:** Lilit Core Team
**Status:** Draft

---

## 1. Executive Summary and Vision

### Vision Statement

Transform Lilit from a sequential task executor into a self-reflecting, learning AI team where agents actively surface cross-cutting insights and communicate tension-based observations to each other after every pipeline run.

### Executive Summary

Today, Lilit agents execute their assigned tasks in isolation. The orchestrator mediates all communication -- agents never speak to each other. This means a QA agent that notices a UX gap has no mechanism to tell the Developer about it. A Developer who spots three different date libraries across the codebase has no way to flag it to the Architect. These observations vanish.

Agent Standups introduces a structured post-pipeline dialogue where each participating agent performs an "Overwatch scan" -- applying their domain expertise beyond their assigned task boundary to the entire pipeline context. Each agent writes a message addressed TO another specific agent about a tension, misalignment, or risk they observed. These messages are stored, displayed in a thread UI, and (in later phases) fed back into future PM planning as "Pipeline Memory."

The key technical insight is **tension-based prompting**. Rather than asking agents to "reflect on their work" (which produces polite filler), we ask them to detect CONFLICTS -- things that violate their domain principles. This turns the standup from performative ceremony into a genuine signal source.

### Key Benefits

- **Lateral value (Phase 1)**: Actionable insights between agents surface issues that sequential execution misses. QA flags UX gaps to Developer. Developer flags codebase inconsistencies to Architect.
- **Vertical value (Phase 2)**: Pipeline Memory enables the PM to learn from past standups. The system improves its own planning over time.
- **Differentiation (Phase 3+)**: Voice-layer standups and live inter-agent messaging create a genuinely novel product experience that no competitor offers.

---

## 2. Named Concepts

### 2.1 Overwatch

After completing their assigned task, each agent performs an **Overwatch scan** -- using their domain expertise to look beyond their task boundary at the whole pipeline context. The name evokes a vantage point: after doing the work, step back and survey the landscape.

**What Overwatch is NOT**: A summary of what the agent did. That information already exists in the pipeline step results. Overwatch is about what the agent NOTICED but was NOT asked to address.

**Five types of Overwatch insights:**

| Type | Description | Example |
|------|-------------|---------|
| Cross-concern | Agent sees something outside their lane | QA notices a button has no loading state (UX gap, not a test failure) |
| Pattern recognition | Trends across multiple tasks/files | Developer spots 3 different date formatting libraries |
| Meta-process | How the pipeline itself could improve | PM notes that architect step was unnecessary for this type of change |
| Design drift | Planned vs. actual divergence | Architect spots implementation deviated from agreed patterns |
| Risk flagging | Potential future problems | Any agent flags a security concern or scaling risk |

### 2.2 The Peripheral Vision Problem

Agents are laser-focused on their assigned task scope. They process the prompt, execute the work, and report results. They have no incentive or mechanism to look sideways. Standups solve this by explicitly prompting agents to EXPAND their scope after completing their task.

### 2.3 Team Dialogue

The standup format is agent-to-agent messages, not monologue status updates. Each agent writes a message TO another specific agent about something they observed. This creates genuine conversation dynamics:

- QA writes TO Developer: "The login button has no loading state -- users will double-click."
- Developer writes TO Architect: "I found three date formatting libraries (dayjs, date-fns, moment). We should consolidate."
- Architect writes TO PM: "The implementation deviated from the agreed API contract in two places."
- PM writes TO Developer: "The fix cycle count (3) suggests we need better acceptance criteria upfront."

### 2.4 Pipeline Memory

Vertical learning where insights from standups feed back into future PM planning. The PM receives a structured summary of past Overwatch insights when planning new pipelines. Over time, the system learns from its own retrospectives.

### 2.5 Tension-Based Prompting

The core anti-pattern to avoid is **performative garbage** -- agents generating polite filler like "Great teamwork everyone!" The solution: prompts must ask agents to detect TENSIONS and MISALIGNMENTS, not "reflect on your work."

The prompt formula targets CONFLICT:
- QA flags things that conflict with **user expectations**
- Developer flags things that conflict with **DRY/SOLID principles**
- Architect flags things that conflict with **agreed design decisions**
- PM flags things that conflict with **process efficiency**

If an agent genuinely sees no tensions, "No tensions detected" is the correct and encouraged output. Silence is signal.

---

## 3. Problem Statement

### Current Challenges

**For the AI team (agents):**
- Agents operate in pure isolation. QA cannot tell Developer about a UX concern it noticed during testing.
- Insights that fall outside an agent's assigned task scope are silently discarded.
- No mechanism for cross-pollination of domain expertise between agents.
- Each pipeline run starts from scratch with no memory of past process learnings.

**For users (Lilit operators):**
- Users see pipeline results but have no visibility into what the team NOTICED beyond pass/fail.
- Process improvements require manual user intervention (changing agent prompts, reordering pipelines).
- No way to detect recurring patterns across pipeline runs (same types of issues keep appearing).

### Why This Matters Now

1. **Sequential execution is table stakes.** Every AI orchestrator can run agents in sequence. The competitive moat is in agents that LEARN and COMMUNICATE.
2. **The context window is large enough.** With 200K+ context windows in 2026, we can afford to feed past standup insights into PM planning prompts without hitting limits.
3. **The infrastructure exists.** Lilit already has EventLog, PipelineRun, AgentRun tables, and a worker/orchestrator pattern. Standups extend this -- they do not require architectural rewrites.

---

## 4. Goals and Success Metrics

### Business Goals

1. Increase perceived intelligence of the AI team by surfacing cross-cutting insights (measured by user engagement with standup content)
2. Reduce fix cycles over time as PM learns from past standups (measured by average fix cycle count per pipeline run)
3. Create a differentiated product experience that competitors cannot easily replicate

### User Goals

1. Gain visibility into what agents noticed beyond their assigned tasks
2. Receive actionable suggestions for improving their codebase that they did not explicitly ask for
3. See the AI team behave more like a real team -- with opinions, observations, and cross-functional awareness

### Success Metrics

#### Primary Metrics (P0)

| Metric | Baseline | Target (3mo) | Target (6mo) |
|--------|----------|--------------|---------------|
| Standup insight quality (rated useful by user) | N/A | 40% of insights rated useful | 60% of insights rated useful |
| Fix cycles per pipeline run | ~1.2 avg | 1.0 avg | 0.8 avg |
| "No tension" rate | N/A | 30-50% (healthy range) | 30-50% |

#### Secondary Metrics (P1)

| Metric | Target |
|--------|--------|
| Standup generation cost | < $0.05 per standup (4 agents, cheap model) |
| Standup generation time | < 30 seconds total |
| User dismissal rate (skip without reading) | < 40% |

#### Anti-Metrics (Things We Do NOT Want)

| Anti-Metric | Threshold | Action |
|-------------|-----------|--------|
| "No tension" rate below 10% | Prompts are too aggressive, producing hallucinated tensions | Tune prompt temperature down, add stronger "silence is OK" language |
| "No tension" rate above 70% | Prompts are too passive, agents not looking hard enough | Tune prompts to be more specific about what to scan for |
| Average standup message > 500 words | Verbose filler, not concise insights | Add word limit to prompt, penalize length |

---

## 5. Non-Goals and Boundaries

### Explicit Non-Goals

- **Real-time chat between agents (Phase 1)**: Agents do not communicate DURING pipeline execution. Standups are POST-pipeline only. Live messaging is Phase 4.
- **User participation in standups**: Users observe standups. They do not participate as a "team member." User feedback comes through the existing chat interface.
- **Agent-to-agent debate**: Standups are single-round messages, not multi-turn conversations. Agent A writes TO Agent B, but Agent B does not respond to Agent A's message in Phase 1.
- **Automatic pipeline modification**: Standup insights are informational only in Phase 1. They do not automatically change future pipeline configurations. That is Phase 5.
- **Voice/TTS**: Audio standups are Phase 3. Phase 1 is text only.

### Phase 1 Boundaries

- Will NOT include: multi-turn dialogue, TTS, pipeline modification, live messaging
- Standup model: Uses the cheapest available model (Gemini Flash or Claude Haiku) -- standups should be cheap
- Storage: Standups stored in DB, associated with PipelineRun
- Trigger: Automatic after pipeline completion (completed or failed status, NOT aborted)
- Agents: Only agents that PARTICIPATED in the pipeline run generate standup messages

---

## 6. User Personas and Use Cases

### Persona 1: Solo Developer (Primary)

**Role:** Full-stack developer using Lilit for personal projects
**Experience:** 3-5 years, comfortable with AI tools

**Goals:**
- Get a second opinion on code quality beyond what the review step catches
- Learn about codebase-wide issues they might miss when focused on a single feature

**Use Cases:**
- After a pipeline builds a new feature, the standup reveals that QA noticed the new page has no error boundary -- something the developer did not think to ask for.
- Developer agent flags that the new code imports a library already available through an existing utility module.

### Persona 2: Tech Lead (Secondary)

**Role:** Engineering lead managing a team that uses Lilit for prototyping
**Experience:** 7+ years, evaluates AI tools for team adoption

**Goals:**
- Understand if the AI team is making consistent architectural decisions
- Track recurring quality issues across pipeline runs

**Use Cases:**
- Reviews standup history to see that Architect has flagged design drift in 3 consecutive runs -- decides to update the project constraints.
- Notices PM consistently flagging unnecessary architect steps -- adjusts settings to skip architect for small changes.

---

## 7. Feature Design

### 7.1 Phase 1: Post-Pipeline Standup (Text-Based Team Dialogue)

#### 7.1.1 Trigger Conditions

**FR-SU-001: Standup trigger** (P0)
After a pipeline run reaches `completed` or `failed` status, the orchestrator generates a standup. Standups are NOT generated for `aborted` pipelines (user explicitly stopped -- no value in reflecting).

*Acceptance Criteria:*
- Given a pipeline that completes successfully, when the summary step finishes, then a standup is generated before the final result is returned.
- Given a pipeline that fails after max fix cycles, when the failure is recorded, then a standup is generated.
- Given a pipeline that is aborted by the user, when the abort is processed, then NO standup is generated.

#### 7.1.2 Agent Selection

**FR-SU-002: Participating agents** (P0)
Only agents that executed at least one step in the pipeline run participate in the standup. The standup iterates through unique `(agent, role)` pairs from `AgentRun` records for that `PipelineRun`.

*Acceptance Criteria:*
- Given a pipeline with steps [pm, architect, developer:code, developer:review, qa:automation], then standup messages are generated for: pm, architect, developer, qa. (Deduplicated by agent type -- developer writes one message covering both code and review observations.)
- Given a pipeline with only [pm, developer:code, developer:review], then QA does NOT participate in the standup.

#### 7.1.3 Overwatch Prompt Structure

**FR-SU-003: Tension-based Overwatch prompt** (P0)
Each agent receives a prompt containing: (a) the full pipeline context (all step results), (b) the original user request, (c) a tension-detection instruction specific to that agent type, (d) a list of other participating agents they can address their message to.

*Acceptance Criteria:*
- Given a standup prompt, it must contain the full pipeline step results (not just the agent's own output).
- Given a standup prompt, the tension-detection instruction must be specific to the agent type (QA scans for user-experience conflicts, Developer scans for code quality conflicts, etc.).
- Given a standup prompt, the agent must be instructed that "No tensions detected" is a valid and encouraged response.

**FR-SU-004: Message format** (P0)
Each standup message must contain: (a) a `to` field naming the recipient agent, (b) an `insight_type` field classifying the observation, (c) a `message` field with the actual content, (d) an `actionable` boolean indicating if this requires action.

*Expected output format:*
```json
{
  "to": "developer",
  "insight_type": "cross-concern",
  "message": "The new /settings page has no loading skeleton. When the API call takes >500ms, users see a blank white panel. Consider adding a Suspense boundary with a skeleton loader.",
  "actionable": true
}
```

*"No tension" output:*
```json
{
  "to": "none",
  "insight_type": "none",
  "message": "No tensions detected. The pipeline execution aligned well with expectations.",
  "actionable": false
}
```

#### 7.1.4 Execution Model

**FR-SU-005: Parallel standup generation** (P1)
Standup messages for all participating agents are generated in parallel (not sequentially). Each agent gets the same pipeline context but a different Overwatch prompt.

*Acceptance Criteria:*
- Given 4 participating agents, all 4 Overwatch prompts are sent simultaneously via `Promise.all`.
- Standup generation completes in roughly the time of the slowest single agent response, not the sum of all responses.

**FR-SU-006: Cost control** (P0)
Standup generation uses the cheapest available model (same logic as summary generation: Gemini Flash if available, Claude Haiku otherwise). Standup cost is tracked separately in the `StandupMessage` records and added to `PipelineRun.runningCost`.

*Acceptance Criteria:*
- Given Gemini API is available, standup messages use Gemini Flash.
- Given only Claude Code is available, standup messages use Claude Haiku.
- The total standup cost for a 4-agent pipeline is under $0.05.

#### 7.1.5 Storage

**FR-SU-007: Standup persistence** (P0)
Standup messages are stored in a new `StandupMessage` table linked to `PipelineRun`. Each message records the author agent, recipient agent, insight type, message content, actionability, model used, and cost.

*Acceptance Criteria:*
- Given a completed standup, all messages are queryable by `pipelineRunId`.
- Given a message with `insight_type: "none"`, it is stored but flagged as no-tension.

#### 7.1.6 UI Display

**FR-SU-008: Standup thread component** (P0)
A new `StandupThread` React component displays standup messages in a Slack-like thread format. Each message shows: agent avatar/icon, agent name, recipient ("to Developer"), insight type badge, message content, and actionable indicator.

*Acceptance Criteria:*
- Given a completed pipeline with standup data, the standup thread appears below the pipeline summary in the chat view.
- Given a "no tension" message, it is displayed with reduced visual prominence (muted styling).
- Given an actionable insight, it displays with an amber/yellow indicator.

**FR-SU-009: Standup in chat history** (P0)
Standup content is saved as a `Message` in the conversation with `role: "standup"` and structured metadata. When loading chat history, standup messages render using the `StandupThread` component instead of the default `MessageBubble`.

*Acceptance Criteria:*
- Given a conversation with standup messages, reloading the page renders the standup thread correctly.
- Given a standup message in the database, the metadata JSON contains the full structured standup data.

### 7.2 Phase 2: Standup Quality & Pipeline Memory

**FR-PM-001: Insight categorization** (P1)
Each standup insight is tagged with one of five categories: `cross-concern`, `pattern`, `process`, `drift`, `risk`. The Overwatch prompt instructs the agent to self-classify.

**FR-PM-002: Pipeline Memory via RAG** (P1)
When the PM generates a new execution plan, `queryMemories()` from the RAG system
surfaces relevant past standup insights (stored with `sourceType: "standup"` and
`significance: 0.7` for actionable insights). This replaces the need for a separate
Pipeline Memory table — the RAG system's vector similarity search naturally surfaces
relevant past observations based on the current user request.

**FR-PM-003: Trend detection via RAG** (P1)
Recurring themes are detected by querying RAG for standup-sourced memories across
a project and clustering by semantic similarity (using Ollama embeddings + cosine
distance). The `/api/standups/trends` endpoint queries the `Memory` table filtered
by `sourceType: "standup"`, grouped by similarity clusters. No separate `InsightTrend`
table needed — the RAG `Memory` table with its vector index handles this.

### 7.3 Phase 3: TTS Voice Layer

**FR-TTS-001: Agent voice characters from personality frontmatter** (P2)
Each agent's TTS voice is configured via the `standup_voice` field in their AGENT.md
personality frontmatter (codename, pitch, speed, accent_hint). No separate voice
config table needed — voice parameters are part of the personality system.

**FR-TTS-002: Audio generation** (P2)
Standup text messages are converted to audio via a TTS API (e.g., ElevenLabs, OpenAI TTS). Audio files are stored and served via a CDN or local storage.

**FR-TTS-003: Playback UI** (P2)
The standup thread includes a "Play standup" button that plays all messages sequentially as an audio recording with agent-specific voices. Each agent's codename and avatar are shown during their segment.

### 7.4 Phase 4: Live Inter-Agent Messaging

**FR-LA-001: Mid-pipeline messaging** (P2)
Agents can pause execution and send a typed message to another agent. Message types: `question`, `flag`, `suggestion`, `handoff-note`.

**FR-LA-002: Synchronous response** (P2)
The receiving agent can respond before the sender continues. This requires changes to the orchestrator's sequential execution model.

### 7.5 Phase 5: Adaptive Pipeline

**FR-AP-001: Dynamic plan modification** (P2)
Based on live messages, the PM can dynamically reorder, add, or remove pipeline steps during execution.

---

## 8. Data Model

### 8.1 New Prisma Models (Phase 1)

```prisma
model StandupMessage {
  id             String      @id @default(cuid())
  pipelineRunId  String
  pipelineRun    PipelineRun @relation(fields: [pipelineRunId], references: [id], onDelete: Cascade)
  fromAgent      String      // "pm" | "architect" | "developer" | "qa"
  fromRole       String?     // sub-role if applicable
  toAgent        String      // "developer" | "architect" | "pm" | "qa" | "none"
  insightType    String      // "cross-concern" | "pattern" | "process" | "drift" | "risk" | "none"
  message        String      // the actual insight text
  actionable     Boolean     @default(false)
  model          String      // model used to generate this message
  costUsd        Float?      // cost of generating this message
  tokensUsed     Int?        // total tokens (input + output)
  createdAt      DateTime    @default(now())

  @@index([pipelineRunId])
  @@index([insightType])
  @@index([fromAgent])
}
```

### 8.2 PipelineRun Extension

Add a relation to the existing `PipelineRun` model:

```prisma
model PipelineRun {
  // ... existing fields ...

  standupMessages StandupMessage[]
}
```

### 8.3 New EventLog Types

Add to the `EVENT_TYPES` constant in `event-log.ts`:

```typescript
standup_generated: "standup_generated",
standup_insight: "standup_insight",
```

### 8.4 Phase 2: No Additional Models Needed (RAG Replaces InsightTrend)

The original plan called for an `InsightTrend` table. With the RAG system in place,
this is unnecessary. Standup insights are ingested into the `Memory` table
(from the RAG plan) with `sourceType: "standup"`. Trend detection uses vector
similarity clustering on these memories.

**How standup insights map to RAG Memory records:**

```
StandupMessage (from standup)          →  Memory (in RAG)
─────────────────────────────              ─────────────────
fromAgent: "qa"                            agent: "qa"
insightType: "cross-concern"               type: "decision"
message: "Missing loading state..."        content: "Missing loading state..."
actionable: true                           significance: 0.7
pipelineRunId: "clx..."                    sourceType: "standup"
                                           sourceId: standupMessage.id
                                           embedding: vector(768) via Ollama
```

Trend queries use `queryMemories()` with `sourceType: "standup"` filter,
then group results by cosine similarity to find recurring themes.

---

## 9. Prompt Engineering

> **Integration with RAG + Personality System**: This section assumes the personality
> system (codenames, voice styles, relationships) and RAG memory system are available.
> See the companion plan for RAG + Ollama + Personalities. When personality is disabled
> in project settings (`personalityEnabled: false`), the personality and relationship
> sections are omitted and agents fall back to generic "PM", "Developer" etc. labels.

### 9.1 Overwatch System Prompt (Shared Preamble)

This preamble is prepended to every agent's Overwatch prompt. It is personality-aware:

```
You are ${codename}, performing an Overwatch scan after a pipeline run.
Communication style: ${personality.voice.style}, ${personality.voice.tone}.

Your job is NOT to summarize what you did -- that information already exists.
Your job is to apply your domain expertise to the ENTIRE pipeline context and
detect TENSIONS, MISALIGNMENTS, or RISKS that nobody explicitly asked you to check.

Rules:
1. You are writing a message TO a specific teammate by name. Pick the most
   relevant recipient for your observation. Use their codename.
2. If you genuinely see no tensions, say so explicitly. Output the "no tension"
   JSON format. Do NOT generate polite filler.
3. Be specific and actionable. "Consider adding error handling" is useless.
   "The /api/users endpoint has no try-catch around the database call on line 47
   of src/routes/users.ts" is useful.
4. Keep your message under 200 words. Concise observations, not essays.
5. You may produce multiple insights (up to 3). Output a JSON array.
6. Stay in character but never let personality override technical accuracy.
   Your personality flavors the delivery, not the substance.

Team members:
${participatingAgents.map(a => `- ${a.codename} (${a.type}) — ${a.personality.voice.style}`).join("\n")}

Output format (JSON array):
[
  {
    "to": "<codename>",
    "insight_type": "<cross-concern|pattern|process|drift|risk>",
    "message": "<your observation, written in your voice>",
    "actionable": <true|false>
  }
]

If no tensions detected:
[
  {
    "to": "none",
    "insight_type": "none",
    "message": "No tensions detected.",
    "actionable": false
  }
]
```

### 9.2 Agent-Specific Overwatch Prompts

#### PM (Sasha) Overwatch

```
## Your Overwatch Lens: Process Efficiency

You are Sasha. You are direct and warm-but-firm. You ship iteratively.

Scan the entire pipeline for PROCESS tensions:

- Were there unnecessary steps? (architect called for a trivial change)
- Did fix cycles indicate poor upfront specification?
- Was the pipeline ordering suboptimal? (review found issues that better
  acceptance criteria would have prevented)
- Did any agent take significantly longer than expected?
- Were skills assigned effectively, or did agents lack context they needed?

Your recipients: Marcus (architect), Kai (developer), River (qa).

## Your Relationship Context
${relationshipContext}
```

#### Architect (Marcus) Overwatch

```
## Your Overwatch Lens: Design Integrity

You are Marcus. You are deliberate, confident, and focused on simplicity.

Scan the entire pipeline for DESIGN tensions:

- Did the implementation deviate from agreed architectural patterns?
- Are there consistency violations? (different patterns used for similar problems)
- Did new code introduce dependencies that conflict with the tech stack decisions?
- Are there scaling concerns in the implementation approach?
- Did the folder structure or module boundaries get violated?

Your recipients: Kai (developer), Sasha (pm), River (qa).

## Your Relationship Context
${relationshipContext}
```

#### Developer (Kai) Overwatch

```
## Your Overwatch Lens: Code Quality & Consistency

You are Kai. You are casual, enthusiastic, and types-first.

Scan the entire pipeline for CODE QUALITY tensions:

- Are there duplicate utilities or redundant libraries?
- Did new code follow different patterns than existing code? (naming conventions,
  error handling approaches, API response formats)
- Are there performance concerns? (N+1 queries, unnecessary re-renders,
  missing indexes)
- Is there dead code or unused imports introduced?
- Are there missing edge cases in the implementation?

Your recipients: Marcus (architect), River (qa), Sasha (pm).

## Your Relationship Context
${relationshipContext}
```

#### QA (River) Overwatch

```
## Your Overwatch Lens: User Experience & Reliability

You are River. You are methodical, dry-humored, and obsessed with edge cases.

Scan the entire pipeline for USER-FACING tensions:

- Are there missing loading states, error boundaries, or empty states?
- Do new UI elements have proper accessibility attributes?
- Are there user flows that could result in confusing or broken states?
- Did the implementation miss edge cases in the acceptance criteria?
- Are there race conditions or timing issues in async operations?

Your recipients: Kai (developer), Marcus (architect), Sasha (pm).

## Your Relationship Context
${relationshipContext}
```

### 9.3 Relationship Context Block

The `relationshipContext` variable is generated by querying `AgentRelationship` for the
current agent's directional relationships. This influences **tone, not content** -- an
agent with high tension toward another might be more pointed, while high rapport
produces a more collaborative tone.

```
Generated by: getRelationshipContext(projectId, agentType) from personality.ts

Example output for Kai (developer):
- Sasha (pm): high trust (0.8) — clean specs lately
- Marcus (architect): neutral (0.5)
- River (qa): mild tension (0.3) — last PR had 3 test failures

This context is injected into the Overwatch prompt so the agent's standup
messages reflect the evolving team dynamics.
```

### 9.4 RAG Memory Context in Standups

Before generating each agent's Overwatch message, query the RAG memory store for
relevant memories. This gives agents awareness of past decisions and patterns:

```typescript
// In generateStandup(), before building each agent's prompt:
const memories = await queryMemories({
  projectId,
  query: `${agentType} overwatch scan for: ${userMessage}`,
  agent: agentType,
  types: ["decision", "code_pattern", "personality"],
  limit: 5,
});
const memoryContext = formatMemoriesForPrompt(memories);
```

The memory context is injected into the assembled prompt as a "What You Remember"
section, giving the agent awareness of past decisions, patterns, and team history.
This prevents agents from flagging tensions that were already addressed, and helps
them reference established patterns when making observations.

### 9.5 Full Standup Prompt Template (Assembled)

```
${OVERWATCH_SYSTEM_PROMPT}       ← personality-aware preamble (9.1)

${AGENT_SPECIFIC_PROMPT}          ← includes relationship context (9.2)

## What You Remember
${memoryContext}                   ← RAG memories relevant to this scan (9.4)

## Pipeline Context

**Original User Request:**
${userMessage}

**Pipeline Steps Executed:**
${stepsContext}

**Pipeline Outcome:** ${pipelineStatus}
**Fix Cycles:** ${fixCycleCount}
**Total Cost:** ${totalCost}

**Participating Team:**
${participatingAgents.map(a => `- ${a.codename} (${a.type})`).join("\n")}

## Your Step Results
${agentOwnResults}

## Other Agents' Results
${otherAgentsResults}

Now perform your Overwatch scan. Write in your voice. Output ONLY the JSON array.
```

---

## 10. API Routes

### 10.1 GET /api/standups

Retrieve standup messages for a pipeline run.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `pipelineRunId` | string | Yes (or projectId) | Specific pipeline run |
| `projectId` | string | Yes (or pipelineRunId) | All standups for a project |
| `limit` | number | No | Max results (default 50) |
| `insightType` | string | No | Filter by insight type |

**Response (200):**

```json
{
  "standups": [
    {
      "id": "clx...",
      "pipelineRunId": "clx...",
      "fromAgent": "qa",
      "fromRole": "automation",
      "toAgent": "developer",
      "insightType": "cross-concern",
      "message": "The /settings page has no loading skeleton...",
      "actionable": true,
      "model": "gemini-2.5-flash",
      "costUsd": 0.001,
      "createdAt": "2026-02-02T12:00:00Z"
    }
  ],
  "total": 4,
  "noTensionCount": 1
}
```

**File:** `src/app/api/standups/route.ts`

### 10.2 GET /api/standups/trends (Phase 2)

Retrieve recurring insight themes across standups.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `projectId` | string | Yes | Project ID |
| `resolved` | boolean | No | Filter resolved/unresolved |

**Response (200):**

```json
{
  "trends": [
    {
      "theme": "missing-loading-states",
      "insightType": "cross-concern",
      "occurrences": 3,
      "lastSeenAt": "2026-02-02T12:00:00Z",
      "resolved": false
    }
  ]
}
```

**File:** `src/app/api/standups/trends/route.ts`

---

## 11. Technical Architecture

### 11.1 Phase 1 Architecture

```
                              EXISTING                                    NEW
                         +--------------+                    +----------------------------+
                         |              |                    |     generateStandup()      |
User Request --> Worker -+-> orchestrate()                   |                            |
                         |              |                    | For each agent:            |
                         |  1. PM Plan  |                    |  1. getAgentDefinition()   |
                         |  2. Confirm  +--- after step 4 --+  2. buildPersonality()     |
                         |  3. Execute  |                    |  3. getRelationshipCtx()   |
                         |  4. Summary  |                    |  4. queryMemories() (RAG)  |
                         |              |                    |  5. buildOverwatchPrompt() |
                         +--------------+                    |  6. runLLM() (cheap model) |
                                                             |  7. parseJSON + store DB   |
                                                             |  8. ingest to RAG memory   |
                                                             +----------------------------+
                                                                         |
                                                              StandupMessage table
                                                              + Memory table (RAG)
                                                                         |
                                                              /api/standups (GET)
                                                                         |
                                                              <StandupThread /> UI
                                                              (uses codenames + avatars)
```

> **Dependency on RAG + Personality system**: `generateStandup()` imports from
> `personality.ts`, `memory.ts`, and `agent-loader.ts` (personality frontmatter).
> If personality is disabled or Ollama is unavailable, standup falls back to
> generic agent labels and skips RAG memory retrieval -- still functional, just
> without personality flavor or memory context.

### 11.2 Orchestrator Integration Point

The standup generation hooks into the orchestrator AFTER the summary step and BEFORE the final checkpoint. This is a single insertion point in `orchestrate()`:

```
// Current flow (lines ~594-614 of orchestrator.ts):
//   4. Generate summary
//   5. Final checkpoint (status: completed)
//   6. Return result
//
// New flow:
//   4. Generate summary
//   4.5 Generate standup (NEW)
//   5. Final checkpoint (status: completed, includes standup data)
//   6. Return result (includes standup data)
```

### 11.3 New Source Files

| File | Purpose |
|------|---------|
| `src/lib/standup.ts` | Core standup logic: prompt building, generation, parsing |
| `src/app/api/standups/route.ts` | GET endpoint for standup retrieval |
| `src/components/standup-thread.tsx` | React component for standup display |

### 11.4 Modified Source Files

| File | Change |
|------|--------|
| `src/lib/orchestrator.ts` | Add standup generation after summary + RAG memory ingestion |
| `src/lib/event-log.ts` | Add `standup_generated` and `standup_insight` event types |
| `src/components/chat.tsx` | Render `StandupThread` for standup messages |
| `prisma/schema.prisma` | Add `StandupMessage` model, extend `PipelineRun` |

### 11.5 Dependencies on RAG + Personality System

The standup feature consumes these modules from the companion RAG plan:

| Module | Import | Usage in Standups |
|--------|--------|-------------------|
| `src/lib/personality.ts` | `buildPersonalityInjection()`, `getRelationshipContext()` | Inject codename, voice style, team dynamics into Overwatch prompts |
| `src/lib/memory.ts` | `queryMemories()`, `formatMemoriesForPrompt()`, `storeMemory()` | Retrieve RAG context before scan, ingest insights after scan |
| `src/lib/agent-loader.ts` | `getAgentDefinition()` | Read personality frontmatter (codename, voice, opinions) |
| `src/lib/embeddings.ts` | (indirect, via memory.ts) | Generate embeddings for standup insight ingestion |

**Graceful degradation**: If personality system is not yet deployed or is disabled:
- `buildPersonalityInjection()` returns `null` → prompts use "PM", "Developer" etc.
- `getRelationshipContext()` returns empty string → no relationship section in prompt
- `queryMemories()` returns `[]` when Ollama is down → no "What You Remember" section
- `storeMemory()` silently fails → insights still stored in `StandupMessage` table, just not in RAG

---

## 12. Implementation Phases

### Phase 1A: Data Layer (Week 1, Days 1-2)

**Objectives:**
- Create the database schema for standup storage
- Extend event log with standup event types

**Deliverables:**
1. Add `StandupMessage` model to `prisma/schema.prisma`
2. Add `standupMessages` relation to `PipelineRun`
3. Run `npx prisma migrate dev --name add_standup_messages`
4. Add standup event types to `src/lib/event-log.ts`

**Dependencies:** None (foundation)

**Functional Requirements:** FR-SU-007

**Prisma migration SQL (expected):**

```sql
CREATE TABLE "StandupMessage" (
    "id" TEXT NOT NULL,
    "pipelineRunId" TEXT NOT NULL,
    "fromAgent" TEXT NOT NULL,
    "fromRole" TEXT,
    "toAgent" TEXT NOT NULL,
    "insightType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "actionable" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT NOT NULL,
    "costUsd" DOUBLE PRECISION,
    "tokensUsed" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StandupMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StandupMessage_pipelineRunId_idx" ON "StandupMessage"("pipelineRunId");
CREATE INDEX "StandupMessage_insightType_idx" ON "StandupMessage"("insightType");
CREATE INDEX "StandupMessage_fromAgent_idx" ON "StandupMessage"("fromAgent");

ALTER TABLE "StandupMessage"
ADD CONSTRAINT "StandupMessage_pipelineRunId_fkey"
FOREIGN KEY ("pipelineRunId") REFERENCES "PipelineRun"("id") ON DELETE CASCADE;
```

### Phase 1B: Standup Engine (Week 1, Days 3-5)

**Objectives:**
- Implement the core standup generation logic
- Build prompt templates for all agent types
- Wire into the orchestrator

**Deliverables:**
1. Create `src/lib/standup.ts` with:
   - `generateStandup()` -- main entry point
   - `buildOverwatchPrompt()` -- assembles the full prompt per agent
   - `parseStandupResponse()` -- parses JSON output from agent
   - `getParticipatingAgents()` -- deduplicates agents from pipeline run
   - Overwatch prompt templates (system preamble + per-agent lens)
2. Modify `src/lib/orchestrator.ts`:
   - Import and call `generateStandup()` after summary generation
   - Pass standup data through to the result
   - Log `standup_generated` event
3. Update `OrchestratorResult` type to include standup data

**Dependencies:** Phase 1A complete

**Functional Requirements:** FR-SU-001, FR-SU-002, FR-SU-003, FR-SU-004, FR-SU-005, FR-SU-006

**Key implementation detail -- orchestrator insertion point:**

```typescript
// In orchestrate(), after generateSummary() call (~line 597):

// 4.5 Generate standup (personality-aware, RAG-enhanced)
appendLog(projectId, `\n${"=".repeat(80)}\n🗣️ GENERATING TEAM STANDUP\n${"=".repeat(80)}\n`);

const standupResult = await generateStandup({
  pipelineRunId: pipelineRunDbId!,
  projectId,
  userMessage,
  steps,
  plan: plan!,
  fixCycleCount: fixCycle,
  totalCost: runningCost,
  // generateStandup() internally calls:
  //   - getAgentDefinition(agent) → reads personality from AGENT.md frontmatter
  //   - buildPersonalityInjection() → codename, voice style, opinions
  //   - getRelationshipContext() → trust/tension/rapport with other agents
  //   - queryMemories() → RAG memories relevant to this agent's overwatch scan
});

if (standupResult.messages.length > 0) {
  appendLog(projectId, `✅ Standup complete: ${standupResult.messages.length} messages\n`);
  runningCost += standupResult.totalCost;

  // 4.6 Ingest standup insights as RAG memories (fire-and-forget)
  // This enables Pipeline Memory: future PM planning can recall past standup insights
  for (const msg of standupResult.messages) {
    if (msg.insightType !== "none") {
      storeMemory({
        projectId,
        agent: msg.fromAgent,
        type: "decision",  // standup insights are team decisions/observations
        title: `[Standup] ${msg.fromCodename} → ${msg.toCodename}: ${msg.insightType}`,
        content: msg.message,
        sourceType: "standup",
        sourceId: msg.id,   // dedup key
        significance: msg.actionable ? 0.7 : 0.4,
      }).catch(() => {});  // fire-and-forget, never blocks pipeline
    }
  }
}
```

**Note:** By ingesting standup insights into the RAG memory store, we get Pipeline
Memory (Phase 2) largely for free. Future `queryMemories()` calls during PM planning
will surface relevant past standup observations via vector similarity, without needing
a separate `InsightTrend` table for basic trend detection.

**Key implementation detail -- standup.ts structure:**

```typescript
// src/lib/standup.ts

import { prisma } from "./prisma";
import { runLLM } from "./llm";
import { getCheapestAvailableModel } from "./providers";
import { calculateCost, formatCost } from "./cost-calculator";
import { logEvent } from "./event-log";
import { buildPersonalityInjection, getRelationshipContext } from "./personality";
import { queryMemories, formatMemoriesForPrompt } from "./memory";
import { storeMemory } from "./memory";
import { getAgentDefinition } from "./agent-loader";

interface StandupInsight {
  to: string;           // codename (e.g. "Kai") or "none"
  insight_type: string;
  message: string;
  actionable: boolean;
}

interface StandupResult {
  messages: Array<{
    fromAgent: string;      // agent type ("developer")
    fromCodename: string;   // personality codename ("Kai")
    fromRole?: string;
    toAgent: string;        // recipient agent type ("qa")
    toCodename: string;     // recipient codename ("River")
    insightType: string;
    message: string;
    actionable: boolean;
    model: string;
    costUsd: number;
  }>;
  totalCost: number;
}

export async function generateStandup(opts: {
  pipelineRunId: string;
  projectId: string;
  userMessage: string;
  steps: Array<{ agent: string; role?: string; title: string; status: string; output: string }>;
  plan: { analysis: string; tasks: Array<{ title: string; description: string; agent: string; role: string }> };
  fixCycleCount: number;
  totalCost: number;
}): Promise<StandupResult> {
  const { pipelineRunId, projectId, steps, plan, userMessage, fixCycleCount, totalCost } = opts;

  // 1. Determine participating agents (deduplicate by agent type)
  const participants = getParticipatingAgents(steps);

  if (participants.length === 0) {
    return { messages: [], totalCost: 0 };
  }

  // 2. Build context shared across all prompts
  const stepsContext = formatStepsForStandup(steps);
  const pipelineStatus = steps.every(s => s.status === "done") ? "SUCCESS" : "PARTIAL FAILURE";

  // 3. Generate all standup messages in parallel
  const { model } = await getCheapestAvailableModel();
  const results = await Promise.all(
    participants.map(agent =>
      generateAgentOverwatch({
        agent,
        model,
        userMessage,
        stepsContext,
        pipelineStatus,
        fixCycleCount,
        totalCost,
        participants,
        steps,
      })
    )
  );

  // 4. Store in database
  let standupTotalCost = 0;
  const storedMessages: StandupResult["messages"] = [];

  for (const result of results) {
    for (const insight of result.insights) {
      const record = await prisma.standupMessage.create({
        data: {
          pipelineRunId,
          fromAgent: result.agent,
          fromRole: result.role,
          toAgent: insight.to,
          insightType: insight.insight_type,
          message: insight.message,
          actionable: insight.actionable,
          model,
          costUsd: result.costPerInsight,
          tokensUsed: result.tokensPerInsight,
        },
      });

      storedMessages.push({
        fromAgent: result.agent,
        fromRole: result.role,
        toAgent: insight.to,
        insightType: insight.insight_type,
        message: insight.message,
        actionable: insight.actionable,
        model,
        costUsd: result.costPerInsight,
      });

      standupTotalCost += result.costPerInsight;
    }
  }

  // 5. Log event
  await logEvent({
    projectId,
    agent: "orchestrator",
    type: "standup_generated",
    data: {
      pipelineRunId,
      messageCount: storedMessages.length,
      noTensionCount: storedMessages.filter(m => m.insightType === "none").length,
      totalCost: standupTotalCost,
    },
  });

  return { messages: storedMessages, totalCost: standupTotalCost };
}
```

### Phase 1C: API & UI (Week 2, Days 1-3)

**Objectives:**
- Build the API endpoint for standup retrieval
- Build the standup thread UI component
- Integrate into the chat view

**Deliverables:**
1. Create `src/app/api/standups/route.ts` -- GET endpoint
2. Create `src/components/standup-thread.tsx` -- thread display component
3. Modify `src/components/chat.tsx`:
   - Store standup data in conversation message metadata
   - Render `StandupThread` for messages with `role: "standup"`
4. Add standup cost to `CostDisplay` component

**Dependencies:** Phase 1B complete

**Functional Requirements:** FR-SU-008, FR-SU-009

**UI component structure:**

```tsx
// src/components/standup-thread.tsx

interface StandupMessageData {
  fromAgent: string;
  fromRole?: string;
  toAgent: string;
  insightType: string;
  message: string;
  actionable: boolean;
}

interface StandupThreadProps {
  messages: StandupMessageData[];
  className?: string;
}

export function StandupThread({ messages, className }: StandupThreadProps) {
  // Filter out no-tension messages for prominent display
  const insights = messages.filter(m => m.insightType !== "none");
  const noTensions = messages.filter(m => m.insightType === "none");

  return (
    <div className={className}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-medium">Team Standup</span>
        <Badge variant="secondary">{insights.length} insights</Badge>
        {noTensions.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {noTensions.length} agent(s) reported no tensions
          </span>
        )}
      </div>

      {/* Insight messages */}
      {insights.map((msg, i) => (
        <StandupMessageCard key={i} message={msg} />
      ))}

      {/* No-tension messages (collapsed) */}
      {noTensions.length > 0 && (
        <div className="text-xs text-muted-foreground mt-2">
          {noTensions.map(m => m.fromAgent).join(", ")} reported no tensions.
        </div>
      )}
    </div>
  );
}
```

**Agent display mapping (uses personality codenames):**

| Agent | Codename | Icon | Color | Voice Style |
|-------|----------|------|-------|-------------|
| pm | Sasha | clipboard | blue | direct, warm-but-firm |
| architect | Marcus | compass | purple | deliberate, confident |
| developer | Kai | code | green | casual, enthusiastic |
| qa | River | shield-check | amber | methodical, dry humor |

The `StandupThread` component displays codenames as the primary label, with agent
type shown as a secondary label (e.g., "**Kai** (developer) → River (qa)").

**Insight type badge colors:**

| Type | Color | Label |
|------|-------|-------|
| cross-concern | amber | Cross-Concern |
| pattern | purple | Pattern |
| process | blue | Process |
| drift | red | Drift |
| risk | orange | Risk |
| none | gray | No Tension |

### Phase 1D: Testing & Polish (Week 2, Days 4-5)

**Objectives:**
- End-to-end testing of standup generation
- Prompt tuning based on real pipeline outputs
- Cost validation
- Edge case handling

**Deliverables:**
1. Test: Pipeline with all 4 agent types produces standup
2. Test: Pipeline with only 2 agents produces standup with only those agents
3. Test: Aborted pipeline does NOT produce standup
4. Test: Failed pipeline produces standup
5. Test: "No tension" output is correctly parsed and stored
6. Test: Malformed JSON output is handled gracefully (retry or skip)
7. Test: Standup cost stays under $0.05 budget for 4 agents
8. Prompt tuning: Run 5+ real pipelines, evaluate tension quality, adjust prompts

**Dependencies:** Phase 1C complete

---

## 13. Risk Assessment

| # | Risk | Probability | Impact | Mitigation |
|---|------|-------------|--------|------------|
| 1 | **Performative garbage**: Agents produce polite filler instead of genuine tensions | High | High | Tension-based prompting, "no tension is valid" instruction, monitor no-tension rate (target 30-50%), iterative prompt tuning |
| 2 | **Hallucinated tensions**: Agents fabricate file paths, line numbers, or issues that do not exist | Medium | High | Instruct agents to only reference specific artifacts from the pipeline context provided. Post-generation validation: check that referenced files exist in the step output. |
| 3 | **JSON parse failures**: Agent outputs malformed JSON | Medium | Low | Robust parser with fallback: try JSON extraction from markdown code blocks, retry once on failure, skip agent on second failure |
| 4 | **Cost creep**: Standups become expensive with verbose prompts | Low | Medium | Use cheapest model, set max_tokens to 1024 per agent, track cost per standup in metrics, alert if >$0.10 |
| 5 | **Latency impact**: Standups add 10-20 seconds to pipeline completion time | Medium | Low | Parallel generation (Promise.all), async option (generate standup after returning pipeline result to user, lazy-load in UI) |
| 6 | **User fatigue**: Users stop reading standups after initial novelty | Medium | Medium | Keep insights short (200 word limit), highlight actionable items, allow collapsing/dismissing, Phase 2 trend aggregation reduces repetition |
| 7 | **Context window overflow**: Pipeline context is too large for standup prompt | Low | Medium | Truncate step outputs (first 2000 chars each), summarize large step results, use the agent's own full output + others' summaries |

### Risk #1 Deep Dive: The Signal-vs-Noise Problem

This is the defining risk for the entire feature. If standups are perceived as noise, users will ignore them permanently and the feature becomes dead weight.

**Defense in depth:**

1. **Prompt design**: Tension-based framing makes it structurally harder to produce filler. The agent must identify a CONFLICT, name a RECIPIENT, and classify the INSIGHT TYPE. These constraints force specificity.

2. **No-tension normalization**: By explicitly telling agents that "no tension" is valid and even preferred over filler, we give them permission to be silent. The no-tension rate becomes a health metric.

3. **Word limit enforcement**: 200 words per insight, 3 insights max per agent. This prevents verbose hedging.

4. **Actionability flag**: Agents must declare if their insight is actionable (requires someone to do something) or observational. This self-classification forces the agent to evaluate its own output.

5. **Iterative tuning**: Phase 1D includes explicit prompt tuning based on real pipeline outputs. The prompts in this document are Version 1 -- they WILL be refined.

6. **User feedback loop (Phase 2)**: Allow users to rate insights as useful/not-useful. Feed this signal back into prompt refinement.

---

## 14. Dependencies

### External Dependencies

| Dependency | Type | Impact if Unavailable |
|------------|------|----------------------|
| Gemini Flash API | Preferred standup model | Fall back to Claude Haiku (higher latency, same cost with subscription) |
| PostgreSQL + pgvector | Storage + vector search | Standups still work without pgvector (just no RAG memory retrieval/ingestion) |
| Ollama | Embedding generation for RAG | Graceful degradation: standup insights stored in DB but not vectorized |

### Internal Dependencies

| Dependency | Type | Impact |
|------------|------|--------|
| `runLLM()` in `src/lib/llm.ts` | Standup generation uses Gemini wrapper | Must support standup prompts (already generic enough) |
| `getCheapestAvailableModel()` in `src/lib/providers.ts` | Model selection for standups | Already exists, no changes needed |
| `calculateCost()` in `src/lib/cost-calculator.ts` | Cost tracking | Already exists, no changes needed |
| `orchestrate()` in `src/lib/orchestrator.ts` | Integration point | Requires modification (see Phase 1B) |
| `src/lib/personality.ts` | Personality injection + relationships | **From RAG plan**. Graceful fallback if not deployed |
| `src/lib/memory.ts` | RAG memory retrieval + ingestion | **From RAG plan**. Graceful fallback if Ollama unavailable |
| `src/lib/embeddings.ts` | Vector embeddings for memory | **From RAG plan**. Indirect dependency via memory.ts |
| Agent `.md` personality frontmatter | Codenames, voice, opinions | **From RAG plan**. Falls back to generic labels |

### Deployment Order

The RAG + Personality system should be deployed **before** the Standup feature:

1. **First**: RAG plan (pgvector, Ollama, `personality.ts`, `memory.ts`, agent personality frontmatter)
2. **Then**: Standup Phase 1 (consumes personality + memory, adds `standup.ts` + `StandupMessage` table)

If standups must ship before the RAG system is ready, the graceful degradation paths
ensure everything still works -- just without personality flavor or memory context.

---

## 15. Non-Functional Requirements

### Security

- **NFR-SEC-001**: Standup messages must not contain raw user credentials or secrets from pipeline step outputs. The prompt instructs agents to reference file paths and line numbers, not to copy sensitive content verbatim.

### Performance

- **NFR-PERF-001**: Standup generation must complete within 30 seconds for a 4-agent pipeline (parallel execution).
- **NFR-PERF-002**: The `/api/standups` GET endpoint must respond within 200ms for queries by pipelineRunId.
- **NFR-PERF-003**: Standup data in the chat view must not increase initial page load time by more than 100ms.

### Reliability

- **NFR-REL-001**: If standup generation fails for any reason, the pipeline result is still returned successfully. Standup failure is non-blocking.
- **NFR-REL-002**: If an individual agent's standup fails (JSON parse error, timeout), other agents' standups are still stored and displayed.

### Maintainability

- **NFR-MAINT-001**: Overwatch prompt templates are stored as constants in `src/lib/standup.ts`, not embedded in agent markdown files. This keeps standup prompts centralized and easy to tune.
- **NFR-MAINT-002**: The standup engine is a standalone module (`src/lib/standup.ts`) with no circular dependencies on the orchestrator. The orchestrator calls into it, not the reverse.

---

## 16. Appendices

### A. Glossary

| Term | Definition |
|------|------------|
| **Overwatch** | Post-task scan where an agent applies domain expertise beyond task boundary |
| **Tension** | A conflict between what was produced and what should have been produced, detected by domain expertise |
| **Lateral value** | Agent-to-agent insights actionable in the next pipeline run |
| **Vertical value** | System-level learning that improves future planning |
| **Pipeline Memory** | PM's accumulated knowledge from past standup insights |
| **Performative garbage** | Polite filler output that contains no actionable signal |
| **No-tension rate** | Percentage of standup messages where agents report no tensions (healthy: 30-50%) |
| **Fix cycle** | When QA/review fails and the PM creates a remediation sub-pipeline |

### B. Example Standup Output (Realistic)

Given a pipeline that builds a user settings page:

**Pipeline:** `pm -> architect -> developer:code -> developer:review -> qa:automation`

**QA Overwatch output:**
```json
[
  {
    "to": "developer",
    "insight_type": "cross-concern",
    "message": "The settings form submits successfully but shows no feedback to the user. After clicking Save, the button stays in its default state. Users will click multiple times thinking nothing happened. Add a toast notification or button state change on successful save.",
    "actionable": true
  }
]
```

**Developer Overwatch output:**
```json
[
  {
    "to": "architect",
    "insight_type": "pattern",
    "message": "The settings page imports date-fns for date formatting, but the existing utils/format.ts already wraps dayjs for the same purpose. The project now has two date libraries. Recommend consolidating on dayjs since it is already a dependency.",
    "actionable": true
  },
  {
    "to": "qa",
    "insight_type": "risk",
    "message": "The settings API endpoint accepts any JSON body without schema validation. Malformed payloads will cause a 500 error instead of a 400. This is not currently tested.",
    "actionable": true
  }
]
```

**Architect Overwatch output:**
```json
[
  {
    "to": "none",
    "insight_type": "none",
    "message": "No tensions detected. Implementation follows the agreed patterns and folder structure.",
    "actionable": false
  }
]
```

**PM Overwatch output:**
```json
[
  {
    "to": "developer",
    "insight_type": "process",
    "message": "The review step flagged 2 issues that were already in the acceptance criteria (input validation, error handling). This suggests the code step did not fully implement the spec. Consider having the code step explicitly check off acceptance criteria before completing.",
    "actionable": true
  }
]
```

### C. Configuration Options

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `standup.enabled` | boolean | true | Enable/disable standup generation per project |
| `standup.maxInsightsPerAgent` | number | 3 | Maximum insights per agent in a standup |
| `standup.maxWordsPerlnsight` | number | 200 | Word limit per insight message |
| `standup.model` | string | auto | Override model for standup generation |

These are stored in `Project.settings` JSON under a `standup` key:

```json
{
  "standup": {
    "enabled": true,
    "maxInsightsPerAgent": 3,
    "maxWordsPerInsight": 200
  }
}
```

### D. Future Phase Technical Notes

#### Phase 2: Pipeline Memory Implementation Sketch

The PM planning prompt (in `buildPMPrompt()`) is extended with a new section:

```
## Past Standup Insights (Pipeline Memory)

Recent observations from your team across the last ${N} pipeline runs:

${formattedInsights}

Consider these observations when planning. If a recurring theme has been flagged
multiple times, prioritize addressing it. If past standups noted process
inefficiencies, adjust your pipeline accordingly.
```

The `formattedInsights` are fetched by querying `StandupMessage` records for the project, filtered to `actionable: true` and `insightType != "none"`, ordered by recency, limited to 20.

#### Phase 4: Live Inter-Agent Communication (Detailed Architecture)

Live inter-agent messaging requires a fundamental change to the orchestrator's execution model. Currently, `orchestrate()` runs steps sequentially via `execSync` in a for-loop. Live messaging requires agents to run concurrently and exchange messages mid-task.

##### The Core Problem

```
CURRENT:  Agent A runs to completion → Agent B starts
DESIRED:  Agent A working... ←message→ Agent B working... (concurrent)
```

Claude Code CLI does not support "pause mid-execution and wait for input." And `execSync` blocks the Node.js event loop. Both must change.

##### Approach: Chunked Cooperative Multitasking

Rather than true OS-level concurrency (which would require fundamentally different agent runtimes), use **chunked execution with message polling**:

1. **Break work into phases**: Instead of one long `runClaudeCode()` call per step, break each agent's work into smaller phases with explicit checkpoints.

   Example for developer:code:
   ```
   Phase 1: "Analyze requirements and plan implementation" → checkpoint
   Phase 2: "Implement core logic" → checkpoint
   Phase 3: "Add error handling and edge cases" → checkpoint
   Phase 4: "Run lint/typecheck, fix issues" → checkpoint
   ```

2. **Message inbox check at each checkpoint**: Between phases, the orchestrator checks a `AgentMessage` table for messages addressed to this agent. If messages exist, they are injected into the next phase's prompt.

3. **Message outbox at each checkpoint**: Each phase can produce outbound messages to other agents (same Overwatch-style tension detection, but mid-task instead of post-task).

4. **Concurrent agents with interleaving**: The orchestrator runs multiple agents in parallel using `Promise.all` on their current phase, then checks for cross-messages before advancing each to the next phase.

##### Execution Model

```
Orchestrator Event Loop:

  while (agents have remaining phases):
    // Run current phase for all active agents in parallel
    results = await Promise.all(
      activeAgents.map(agent => runPhase(agent, agent.currentPhase))
    )

    // Collect outbound messages from all agents
    outbound = results.flatMap(r => r.messages)

    // Route messages to recipient inboxes
    for (msg of outbound):
      recipientInbox[msg.to].push(msg)

    // Advance each agent, injecting any inbox messages
    for (agent of activeAgents):
      agent.currentPhase++
      agent.inboxMessages = recipientInbox[agent.type]
```

##### New Data Model for Live Messages

```prisma
model AgentMessage {
  id             String      @id @default(cuid())
  pipelineRunId  String
  pipelineRun    PipelineRun @relation(fields: [pipelineRunId], references: [id], onDelete: Cascade)
  fromAgent      String      // sender agent type
  fromRole       String?
  toAgent        String      // recipient agent type
  messageType    String      // "question" | "flag" | "suggestion" | "handoff" | "response"
  content        String      // the message text
  phase          Int         // which execution phase this was sent during
  parentId       String?     // reply-to message ID (for threaded conversations)
  parent         AgentMessage? @relation("MessageThread", fields: [parentId], references: [id])
  replies        AgentMessage[] @relation("MessageThread")
  createdAt      DateTime    @default(now())

  @@index([pipelineRunId, toAgent])
  @@index([parentId])
}
```

##### Migration from execSync to Async

The biggest technical change: `claude-code.ts` must move from `execSync` to `spawn` with streaming.

```typescript
// CURRENT (blocking):
const result = execSync(`claude --model ${model} --print "${prompt}"`, opts);

// REQUIRED (async, streaming):
const proc = spawn('claude', ['--model', model, '--print', prompt], opts);
const output = await streamToString(proc.stdout);
```

This unblocks the Node.js event loop and allows multiple agents to run concurrently.

##### When Live Messaging Adds Value vs. Waste

**Genuinely useful:**
- QA asks Developer: "Where is the test data factory? I need seed data for integration tests."
- Architect flags Developer mid-implementation: "You're using REST for this endpoint but the architecture spec calls for GraphQL here."
- Developer asks QA: "Should I add data-testid attributes to these components for your automation?"

**Wasteful (avoid):**
- Agents asking questions they could answer from the pipeline context already provided
- Agents sending status updates ("I'm 50% done") -- that's what the live log is for
- Agents sending encouragement or acknowledgments

The prompt for each checkpoint must include: "Only send a message to another agent if you have a QUESTION you cannot answer from your current context, or a TENSION you've detected that the recipient needs to know about NOW (not after you finish)."

##### Estimated Architecture Impact

| Component | Change Required |
|-----------|----------------|
| `claude-code.ts` | Replace `execSync` with async `spawn` + streaming |
| `orchestrator.ts` | Replace sequential for-loop with concurrent event loop |
| `worker.ts` | Support long-running async execution |
| `prisma/schema.prisma` | Add `AgentMessage` model |
| `src/lib/standup.ts` | Adapt to use mid-pipeline messages as additional standup context |
| `/api/chat` route | Handle streaming results from concurrent agents |
| UI (chat.tsx) | Show real-time agent-to-agent messages as they happen |

This is the most architecturally expensive phase. Do not attempt until Phases 1-3 are validated and delivering value.

---

#### Phase 5: Voice Communication Layer (Detailed Architecture)

##### Honest Technical Assessment

LLMs process text internally. A "full voice pipeline" between agents means:

```
Agent A text → TTS → audio file → (optional: STT → text) → Agent B
```

There are three levels of voice integration, with different cost/value tradeoffs:

| Level | Description | Functional Value | Marketing Value | Complexity |
|-------|-------------|-----------------|-----------------|------------|
| **TTS-out only** | Agent text → speech for user to listen | None (agents still work in text) | High (demo wow-factor) | Low |
| **Full voice round-trip** | Agent A speaks → STT → Agent B reads text | Marginal (same as text, with latency) | Very high (feels like real conversation) | Medium |
| **Native multimodal** | Agents send/receive audio natively via multimodal models | Potential (audio carries tone/emphasis) | Very high | High (model-dependent) |

##### Recommended: Layered Voice Architecture

Build voice as a **presentation layer on top of text communication**, with an optional native audio path for models that support it.

```
                    ┌─────────────────────────────┐
                    │     Voice Presentation Layer │
                    │  (TTS out / STT in optional) │
                    └──────────┬──────────────────┘
                               │
                    ┌──────────▼──────────────────┐
                    │   Text Communication Layer   │
                    │  (AgentMessage / Standup)     │
                    └──────────┬──────────────────┘
                               │
                    ┌──────────▼──────────────────┐
                    │   Agent Execution Layer       │
                    │  (orchestrator / workers)     │
                    └──────────────────────────────┘
```

##### TTS Implementation — Reads from Personality Frontmatter

Voice config is already defined in the personality system's `standup_voice` field
in each agent's AGENT.md frontmatter. No separate `AgentVoiceConfig` needed —
the voice layer reads directly from the personality data.

**Source of truth** (from personality frontmatter in AGENT.md):
```yaml
personality:
  codename: "Kai"
  standup_voice:
    pitch: medium-high
    speed: 1.2
    accent_hint: energetic-casual
    sample_line: "OK so I finished the API routes yesterday, types are solid."
```

**Runtime voice resolution:**
```typescript
// src/lib/voice.ts (NEW)
import { getAgentDefinition } from "./agent-loader";

interface VoiceConfig {
  provider: "elevenlabs" | "openai" | "google" | "local-ollama";
  voiceId: string;           // provider-specific voice ID
  speed: number;             // from personality.standup_voice.speed
  pitch: string;             // from personality.standup_voice.pitch
  accentHint: string;        // from personality.standup_voice.accent_hint
}

function getVoiceConfig(agentType: string): VoiceConfig {
  const def = getAgentDefinition(agentType);
  const sv = def?.personality?.standup_voice;

  // Map personality voice hints to TTS provider settings
  return {
    provider: getConfiguredTTSProvider(),  // from project settings
    voiceId: resolveVoiceId(agentType, sv),
    speed: sv?.speed ?? 1.0,
    pitch: sv?.pitch ?? "medium",
    accentHint: sv?.accent_hint ?? "neutral",
  };
}
```

**Voice mapping (derived from personality frontmatter):**
| Agent | Codename | Frontmatter `standup_voice` | TTS Mapping |
|-------|----------|---------------------------|-------------|
| PM | Sasha | pitch: medium, speed: 1.0, calm-professional | Measured pace, warm authority |
| Architect | Marcus | pitch: medium-low, speed: 0.9, deliberate-precise | Slower, confident, weighty |
| Developer | Kai | pitch: medium-high, speed: 1.2, energetic-casual | Fast, informal, technical |
| QA | River | pitch: medium, speed: 1.0, methodical-dry | Even, precise, hint of dryness |

##### Voice Generation Flow

```
1. Agent produces StandupMessage (text, personality-flavored)
2. Voice service receives text + agent type
3. Read standup_voice from agent's personality frontmatter
4. Map personality voice hints to TTS provider params
5. Call TTS API
6. Store audio file (local filesystem or S3/CDN)
7. Return audio URL to UI
8. UI plays audio with agent codename + avatar animation
```

##### New API Route

```
POST /api/voice/generate
  Body: { messageId: string, format: "mp3" | "wav" }
  Response: { audioUrl: string, durationMs: number }

GET /api/voice/{messageId}.mp3
  Response: audio file stream
```

##### Full Voice Round-Trip (Agent-to-Agent via Voice)

If you want agents to genuinely "hear" each other (for the theatrical effect):

```
Agent A finishes phase → produces text message
    ↓
TTS converts Agent A's message to audio
    ↓
Audio stored + played in UI (user hears it)
    ↓
STT converts audio back to text (or just use original text — same result)
    ↓
Text injected into Agent B's prompt as: "[Voice message from Agent A]: ..."
    ↓
Agent B responds with text → TTS → audio → UI playback
```

**Honest note:** The STT step is functionally redundant since we already have the original text. The only reason to include it is if you want the "full pipeline" for demonstration purposes or if using natively multimodal models that can process audio embeddings directly.

##### Native Multimodal Path (Future)

When models like Gemini 2.5 or future Claude versions support audio input natively:

```
Agent A text → TTS → audio → Gemini processes audio directly (no STT)
```

This could add genuine value because:
- Audio carries prosodic information (emphasis, urgency) that text loses
- Multimodal models may extract nuance from tone
- The pipeline becomes genuinely voice-native, not voice-as-decoration

This depends on model capabilities and should be evaluated when native audio models mature.

##### Integration with RAG + Agent Personalities

**Note:** A parallel feature initiative is adding local RAG (via pgvector) and persistent agent personalities (via Ollama embeddings). Voice and personalities are deeply complementary:

- RAG stores each agent's personality traits, communication style, and past interaction patterns
- Voice config is informed by personality (a cautious QA agent speaks more slowly and precisely)
- Past standup voice recordings can be indexed in RAG for "what did the team discuss last week?"
- Personality-consistent voice selection: if a user customizes their PM to be "informal and fast-paced," the voice config adapts

The standup voice feature should consume personality data from the RAG system when available, falling back to defaults when personality data hasn't been configured yet.

##### Cost Estimates (Voice)

| Provider | Cost per 1K chars | Est. cost per standup (4 agents, ~800 words) |
|----------|-------------------|----------------------------------------------|
| ElevenLabs (Creator) | $0.30 | ~$1.20 |
| OpenAI TTS | $0.015 | ~$0.06 |
| Google Cloud TTS | $0.016 | ~$0.06 |
| Local (Coqui/Bark via Ollama) | Free | $0.00 (GPU cost only) |

**Recommendation:** Start with OpenAI TTS for cost efficiency. Move to ElevenLabs for premium voice quality if marketing value justifies the cost. Explore local TTS via Ollama for zero-cost option (lower quality but aligns with local-first philosophy of the RAG feature).

---

#### Phase 6: Adaptive Pipeline (Agents Modify Plan Mid-Execution)

Based on live messages from Phase 4, agents can suggest pipeline modifications:

1. PM receives live messages from all agents during execution
2. PM evaluates if the pipeline needs adjustment
3. PM can: add steps, remove upcoming steps, reorder steps, change agent assignments
4. Orchestrator applies PM's modifications to the remaining pipeline

This is the most advanced phase. It turns the orchestrator from a plan executor into an adaptive system that responds to real-time team dynamics. Requires all of Phases 1-5 to be stable before attempting.
