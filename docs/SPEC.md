# Lilit — AI Agent Orchestration Platform

## Spec Document (POC Complete — Feb 2, 2026)

---

## 1. Vision

A web app where you describe what you want built in natural language, and a team of AI agents (PM, Developer, QA) collaborate to produce working, tested code — with real-time progress visible in the UI.

---

## 2. What Exists & Works (POC)

### 2.1 Full Pipeline — Proven ✅

The end-to-end pipeline runs successfully:

```
User prompt → PM (plan) → Developer:code → Developer:review
  → [if issues] PM re-eval → Developer:fix → Developer:review
  → QA:manual (Playwright + headless Chromium) → Summary → Done
```

**Test run results (to-do list app):**
- 10 agent steps, ALL completed
- Feedback loop worked: Review found 7 issues → PM re-eval → Dev fixed → Re-review approved
- QA ran 15 Playwright tests, 100% pass, 13 screenshots captured
- Total time: ~10 min 30 sec
- Total cost: ~$0.18 (all Claude Sonnet via CLI)

### 2.2 Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16.1.6 (Turbopack) |
| DB | PostgreSQL (`lilit:lilit@localhost:5434/lilit`) |
| ORM | Prisma 7 |
| UI | Tailwind CSS 4 + shadcn/ui (dark theme) |
| Agent Runtime | Claude Code CLI (`claude -p`) |
| Language | TypeScript 5, strict mode |
| Package Manager | npm |

### 2.3 Architecture

```
Browser (React) 
    ↓ POST /api/chat
API Route (route.ts) 
    ↓ spawn worker
Worker (worker.ts via bunx tsx)
    ↓ calls orchestrate()
Orchestrator (orchestrator.ts)
    ↓ PM → pipeline steps → summary
Claude Code CLI (claude-code.ts)
    ↓ execSync with env vars
Claude API (Anthropic)
```

**Key design decisions:**
- Worker process is spawned separately (Next.js Turbopack kills long-running child processes)
- `execSync` with temp files (async `spawn` hangs from Node.js context with Claude Code CLI)
- Prompts passed via `$LILIT_PROMPT` env variable (NOT `$(cat file)` — shell expansion breaks on backticks/$ in prompt content)
- System prompts via `$LILIT_SYS_PROMPT` env variable
- `--strict-mcp-config` with empty JSON to prevent loading user's MCP servers
- `--permission-mode bypassPermissions` for full file access
- `--output-format text` (stream-json hangs from spawn)
- File-based log polling for live UI updates (SSE output events never flush through Next.js dev server)

---

## 3. File Structure

```
~/src/ai/lilit/
├── prisma/
│   ├── schema.prisma          # DB schema (Project, Conversation, Message, Task, AgentRun, EventLog)
│   └── prisma.config.ts
├── skills/                     # Agent skills (SKILL.md files)
│   ├── next-best-practices/
│   ├── react-best-practices/
│   ├── webapp-testing/
│   ├── differential-review/
│   ├── insecure-defaults/
│   ├── static-analysis/
│   ├── modern-python/
│   └── composition-patterns/
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout (dark theme)
│   │   ├── page.tsx            # Main page (project selector + chat)
│   │   └── api/
│   │       ├── chat/route.ts   # POST: spawn worker, run pipeline. GET: message history
│   │       ├── logs/route.ts   # GET: poll /tmp/lilit-live.log (offset-based)
│   │       ├── abort/route.ts  # POST: abort active pipeline
│   │       └── projects/route.ts # CRUD for projects
│   ├── components/
│   │   ├── chat.tsx            # Chat UI + log panel (split view)
│   │   ├── project-selector.tsx
│   │   └── ui/                 # shadcn components (button, badge, textarea, etc.)
│   └── lib/
│       ├── orchestrator.ts     # ⭐ Main pipeline logic (PM-driven, feedback loops)
│       ├── agents.ts           # Agent definitions (4 agents, role switching, system prompts)
│       ├── claude-code.ts      # Claude Code CLI wrapper (execSync, env vars, logging)
│       ├── event-log.ts        # Append-only event log (Layer 2 hybrid context)
│       ├── skills.ts           # Skill loading, per-agent injection, project swapping
│       ├── llm.ts              # ✅ Gemini provider — @ai-sdk/google (PM, Architect, Summary)
│       ├── worker.ts           # Separate process entry point for pipeline execution
│       ├── prisma.ts           # Prisma client singleton
│       └── utils.ts            # cn() utility
├── .env                        # DATABASE_URL + ANTHROPIC_API_KEY
├── mcp-empty.json              # Empty MCP config for Claude Code CLI
└── test-prompts.md             # Test prompts collection
```

---

## 4. Core Modules — How They Work

### 4.1 orchestrator.ts — The Brain

**Flow:**
1. Get event history for project context
2. Ask PM to create execution plan (JSON with tasks + pipeline order)
3. Parse PM plan → extract pipeline steps
4. Execute each step sequentially:
   - Build prompt with event history + task description + acceptance criteria
   - Run via Claude Code CLI
   - Log event to DB
   - Check if step failed → if yes, ask PM to re-evaluate → inject fix steps
5. Generate summary
6. Return result to API

**Feedback loop:** QA/review failure → PM re-eval → Dev:fix → Re-review (max 3 cycles)

**isFailure() logic:**
- Parse JSON `approved: false` or `passed: false` → failure
- Parse JSON `approved: true` or `passed: true` → NOT failure
- QA: match `(\d+)\s+fail` where number > 0 (avoids "0 failed" false positive)
- Review: check `"approved": false` or 🔴

### 4.2 agents.ts — Agent Definitions

4 agents with role switching:

| Agent | Roles | Provider | Model | Purpose |
|-------|-------|----------|-------|---------|
| PM | — | Gemini | gemini-3-pro-preview | Plans tasks, decides team composition, re-evaluates on failure |
| Architect | — | Gemini | gemini-3-pro-preview | Tech stack & structure (only for new projects) |
| Developer | code, review, fix, devops | Claude Code CLI | sonnet | Writes, reviews, fixes code |
| QA | automation, manual | Claude Code CLI | sonnet | Writes tests (vitest) or browser tests (Playwright) |

Each agent has detailed system prompts defining output format (JSON for PM/Review/QA, code for Developer).

### 4.3 claude-code.ts — CLI Wrapper

```typescript
runClaudeCode({ prompt, cwd, model, systemPrompt, timeoutMs, agentLabel })
```

- Writes prompt/system-prompt to environment variables (`$LILIT_PROMPT`, `$LILIT_SYS_PROMPT`)
- Runs: `claude -p "$LILIT_PROMPT" --model sonnet --output-format text --permission-mode bypassPermissions --mcp-config <empty> --strict-mcp-config`
- Appends output to `/tmp/lilit-live.log` for UI polling
- Supports abort via `abortActiveProcess()` (sets flag, checked between steps)
- Default timeout: 30 minutes

### 4.4 event-log.ts — Shared Memory

Append-only event log in PostgreSQL. Each agent run produces an event. Events are formatted and injected into subsequent agent prompts as context.

### 4.5 skills.ts — Skill System

- Skills stored in `skills/{name}/SKILL.md`
- `STACK_SKILLS` maps stack → agent role → skill names
- `swapProjectSkills()` copies SKILL.md files into project's `.claude/skills/` directory
- Security skills (differential-review, insecure-defaults, static-analysis) auto-added for review role
- 8 skills installed from VoltAgent/awesome-agent-skills ecosystem

### 4.6 Chat UI (chat.tsx)

Split view:
- **Left panel**: Chat messages (user blue, lilit dark gray, errors red)
- **Right panel**: Live log output (polls `/api/logs?offset=N` every 1.5s)
- **Header**: Project name, Hide/Show Log toggle, Stop button (abort)
- **Input**: Textarea with Enter to send, disabled during pipeline

### 4.7 worker.ts — Process Isolation

Spawned by API route via `bunx tsx worker.ts <projectId> <conversationId> <message>`. Writes JSON result to stdout. 10-minute timeout.

---

## 5. Database Schema

```
Project → has many Conversations, Tasks, AgentRuns, EventLogs
Conversation → has many Messages
Task → has many AgentRuns (subtask hierarchy via parentId)
AgentRun → tracks agent, role, model, input, output, status, duration, cost
EventLog → append-only, typed events with JSON data
```

---

## 6. Known Issues & Bugs Fixed

### Fixed ✅
1. **Shell expansion bug**: `$(cat file)` inside double quotes caused bash to interpret backticks and `$` in prompt content. Fixed by using `$LILIT_PROMPT` env variable.
2. **"0 failed" infinite loop**: QA output "15 passed, 0 failed" triggered `isFailure()` because it matched "fail" substring. Fixed by parsing the number before "fail".
3. **MCP server hang**: User's personal MCP servers loaded when spawning Claude Code CLI, causing hangs. Fixed with `--strict-mcp-config` + empty config JSON.
4. **OAuth token hang**: OAuth token worked from terminal but caused hangs from spawn. Switched to `ANTHROPIC_API_KEY`.

### Known Issues (Not Yet Fixed)
1. ~~**Summary re-triggers QA**~~: Fixed — `generateSummary()` now uses `runLLM()` (Gemini Flash) instead of `runClaudeCode()`, no tool access = no accidental pipeline re-trigger.
2. **Event history grows unbounded**: All past events are fed to agents. Long-running projects will have huge prompts. Need truncation/summarization. → See 7.3.4
3. **SSE output events don't flush**: `agent_start`/`agent_done` SSE events work, but `output` chunk events never reach the browser (likely Next.js dev server buffering). Workaround: file-based polling. → See 7.4.1
4. **Orphan processes**: Claude Code CLI IDE integration leaves ~20+ background processes. The `--strict-mcp-config` flag prevents interaction, but they consume RAM. → See 7.4.2
5. **No concurrent agent tracking**: `activeProcess` is a module-level singleton — only one process tracked at a time. → See 7.3.3
6. **Port conflict**: QA agent starts dev server on port 51000 (same as Lilit). Needs dynamic port or port isolation. → See 7.3.6

---

## 7. What Needs To Be Done

### 7.1 Cost Optimization — Dual Provider Architecture ✅ IMPLEMENTED

**Strategy:** Two providers — Claude Code CLI (subscription, $0) for coding agents, Gemini API for planning/UI agents.

| Agent | Provider | Model | Cost | Why |
|-------|----------|-------|------|-----|
| PM | Gemini | gemini-3-pro-preview | Free/cheap | Planning only, no tools needed |
| Architect | Gemini | gemini-3-pro-preview | Free/cheap | Design only, no tools needed |
| Summary | Gemini | gemini-2.5-flash | Free | Text summarization |
| Developer | Claude Code CLI | sonnet | $0 (subscription) | Needs file access, shell, tools |
| QA | Claude Code CLI | sonnet | $0 (subscription) | Needs Playwright, shell, tools |

**Provider routing in `orchestrator.ts` → `runAgent()`:**
- Checks `agents[type].provider` field ("gemini" | "claude-code")
- Gemini agents → `runLLM()` from `llm.ts` (direct API, `@ai-sdk/google`)
- Claude agents → `runClaudeCode()` from `claude-code.ts` (CLI with subscription auth)
- Per-role override supported via `roles[role].provider` / `roles[role].model`

**Files:**
- `agents.ts` — `provider: Provider` field on each agent, `getProviderConfig()` helper
- `llm.ts` — Gemini wrapper with logging to shared log file + token tracking
- `orchestrator.ts` — `runAgent()` branches by provider, `generateSummary()` uses Gemini Flash

**Environment:**
```env
# Gemini — for PM, Architect, Summary agents
GOOGLE_GENERATIVE_AI_API_KEY="..."   # from https://aistudio.google.com/apikey or Firebase/Antigravity
```

**IMPORTANT — Claude Code CLI Auth:**
- Claude Code CLI (`claude -p`) uses **subscription auth** (Pro/Max plan) — NO API key needed!
- Do NOT pass `ANTHROPIC_API_KEY` in env — it overrides subscription and costs money per token
- The subscription auth is a setup-token (`sk-ant-oat01-...`) stored in `~/.claude/` or OpenClaw's auth store
- This token has **no expiry** but is intended for CLI use only (direct API calls may be rate-limited)
- Developer + QA agents should ALWAYS use `claude -p` CLI to stay on subscription
- If subscription auth stops working, re-run `claude setup-token` and paste it
- **Dev/QA cost: $0 per pipeline** (included in Claude Pro/Max subscription!)

**DO NOT try to extract the setup-token for direct API calls** — Anthropic may rate-limit or block non-CLI usage. Always go through `claude -p`.

### 7.2 UI — Chat & Workspace

#### 7.2.1 Pipeline Progress Panel
- [ ] **Step indicators in chat**: Show which agent is running with spinning/done/failed icons per step (was in old SSE approach, lost when switching to file polling)
- [ ] **Step counter**: "Step 3/7 — Developer:code" with elapsed time per step
- [ ] **Pipeline timeline**: Visual bar showing all steps — completed (green), active (pulsing), pending (gray), failed (red)
- [ ] **Estimated time**: Based on historical `AgentRun.durationMs` averages per agent/role

#### 7.2.2 Log Panel (Right Side)
- [ ] **Syntax highlighting**: Code blocks in log output get language-aware highlighting
- [ ] **Collapsible sections**: Each agent step is a collapsible section with header (agent, duration, status)
- [ ] **Auto-scroll with sticky bottom**: Follow new output, but allow manual scroll up without jumping
- [ ] **Search/filter**: Filter log by agent name, search for text
- [ ] **Download**: Export full log as `.txt` or `.md`

#### 7.2.3 Settings Panel
- [ ] **Provider per agent**: Dropdown to switch each agent between Claude Code CLI / Gemini / other providers
- [ ] **Model per agent**: Select model (sonnet, opus, gemini-3-pro-preview, gemini-2.5-flash, etc.)
- [ ] **Agent toggles**: Enable/disable specific agents — e.g., skip QA for quick iteration, skip Architect for existing projects
- [ ] **Budget limit**: Max cost per pipeline run — abort if exceeded (tracked via `AgentRun.cost`)
- [ ] **Timeout per agent**: Override default 30-min timeout per agent/role
- [ ] **System prompt editor**: View/edit agent system prompts from UI (advanced mode)
- [ ] **Skills toggle**: Enable/disable specific skills per project

#### 7.2.4 Project Management
- [ ] **New project form**: Name, local path (file picker or manual), stack selection (Next.js/React/Python/etc.), git repo URL (optional clone)
- [ ] **Project dashboard**: List of projects with last activity, total runs, success rate
- [ ] **Project settings**: Default provider/model overrides, attached skills, working directory
- [ ] **Delete/archive project**: Soft delete with conversation history preserved

#### 7.2.5 Conversation History
- [ ] **Sidebar**: List of past conversations per project (like ChatGPT sidebar)
- [ ] **Load previous**: Click conversation → load messages + agent steps + log
- [ ] **Continue conversation**: Send follow-up messages in existing conversation context
- [ ] **Context carry-over**: PM receives summary of prior conversation when continuing

#### 7.2.6 Cost & Analytics Dashboard
- [ ] **Cost per run**: Show actual token cost per agent step (from provider API response)
- [ ] **Cost breakdown**: Pie chart — which agents cost the most
- [ ] **Run history table**: All pipeline runs with duration, steps, cost, status
- [ ] **Agent performance**: Average duration, success rate, retry count per agent/role
- [ ] **Subscription usage**: Track Claude CLI usage against Pro/Max limits (if available)

### 7.3 Pipeline & Agent Improvements

#### 7.3.1 Skills System (Partially Built)
- [ ] **Wire skills into prompts**: `loadSkillsForPrompt()` exists but isn't injected into agent system prompts during orchestrator execution — need to append skill content to system prompt
- [ ] **Stack auto-detection**: Read `package.json` / `requirements.txt` / `Cargo.toml` to determine stack, auto-select matching skills
- [ ] **Custom skills**: User can add project-specific SKILL.md files via UI
- [ ] **Skill marketplace**: Browse and install skills from VoltAgent/awesome-agent-skills ecosystem

#### 7.3.2 Smarter PM
- [ ] **Complexity estimation**: PM estimates task size (S/M/L) → skip QA:manual for trivial changes, add QA:automation for anything non-trivial
- [ ] **Adaptive pipeline**: PM can choose to skip review for simple formatting changes, or add extra review rounds for security-sensitive code
- [ ] **Learning from history**: PM reads past `AgentRun` results for the project to avoid repeating failed approaches
- [ ] **Sub-task decomposition**: Large tasks → PM splits into independent sub-tasks that can parallelize

#### 7.3.3 Parallel Execution
- [ ] **Concurrent agent runs**: Independent tasks in PM plan (no `dependsOn` overlap) run in parallel
- [ ] **Process pool**: Replace singleton `activeProcess` with a pool — track multiple concurrent Claude Code CLIs
- [ ] **Fan-out/fan-in**: PM plans tasks with `dependsOn` graph → orchestrator executes in topological order with max parallelism

#### 7.3.4 Context Window Management
- [ ] **Event history truncation**: Keep last N events per project, summarize older ones
- [ ] **Prompt budget**: Calculate token count per prompt, trim context if exceeding model limit
- [ ] **Conversation summary**: After N messages, summarize conversation for follow-up context instead of full history
- [ ] **Smart context selection**: Only include events relevant to current task (filter by agent, type, recency)

#### 7.3.5 Git Integration
- [ ] **Auto-commit**: After each successful Developer:code/fix step, auto-commit with descriptive message from PM plan
- [ ] **Branch per feature**: Create feature branch before pipeline starts, merge to main on success
- [ ] **Diff in review**: Developer:review sees git diff instead of raw output (more reliable)
- [ ] **Rollback**: On pipeline failure, `git reset` to pre-pipeline state
- [ ] **PR creation**: Option to push branch and create GitHub PR with pipeline summary as description

#### 7.3.6 Port Isolation
- [ ] **Dynamic port assignment**: QA agent gets unique port (51001+) for dev server, avoiding conflict with Lilit on :51000
- [ ] **Port pool**: Track assigned ports, release on step completion
- [ ] **Base URL injection**: Pass `BASE_URL=http://localhost:<port>` to QA agent's Playwright config

#### 7.3.7 Bug Injector / Gremlin Agent (Experimental)
- [ ] **Purpose**: Intentionally introduce subtle bugs to test QA quality
- [ ] **Bug types**: Off-by-one, missing null checks, wrong comparisons, hardcoded values, race conditions
- [ ] **Pipeline**: Dev:code → Gremlin:inject → QA:automation → score (did QA catch all injected bugs?)
- [ ] **Metrics**: QA catch rate — measures test coverage quality

### 7.4 Production & Infrastructure

#### 7.4.1 Real-time Streaming
- [ ] **Fix SSE buffering**: Current issue — `agent_start`/`done` events flush, but `output` chunks don't (Next.js dev server buffering)
- [ ] **WebSocket alternative**: Replace SSE with WebSocket for bidirectional real-time communication
- [ ] **Hybrid approach**: Keep file polling as fallback, add WebSocket for output chunks when available

#### 7.4.2 Error Recovery
- [ ] **Retry with backoff**: Failed agent runs retry up to 2x with exponential backoff (5s, 15s)
- [ ] **Provider fallback**: If Gemini fails (rate limit, 500), fallback to Claude Code CLI for that step
- [ ] **Graceful degradation**: If QA fails to start Playwright, skip manual testing and note in summary
- [ ] **Process cleanup**: Kill orphan Claude Code CLI processes on pipeline start/end

#### 7.4.3 Authentication & Multi-User
- [ ] **NextAuth**: GitHub/Google OAuth login
- [ ] **User-scoped projects**: Each user sees only their projects
- [ ] **API key management**: Users provide their own Anthropic/Google API keys in settings
- [ ] **Rate limiting**: Per-user pipeline concurrency limits

#### 7.4.4 Multi-Project Isolation
- [ ] **Separate working directories**: Each project runs agents in its own cwd (already modeled in DB)
- [ ] **Isolated event logs**: Events scoped by project (already implemented)
- [ ] **Separate git repos**: Each project is its own git repo
- [ ] **Environment isolation**: Per-project `.env` support for different API keys or configs

#### 7.4.5 Deployment
- [ ] **Docker Compose**: `docker-compose.yml` with app + PostgreSQL + volume mounts for project dirs
- [ ] **Production build**: `next build` + standalone output, environment validation on start
- [ ] **Health checks**: `/api/health` endpoint for container orchestration
- [ ] **Persistent storage**: Mount project directories and DB data as volumes
- [ ] **Remote execution**: Support connecting to remote machines for agent execution (SSH or similar)

---

## 8. Environment Setup

```bash
# Prerequisites
- Node.js 25+
- PostgreSQL running locally (brew services start postgresql)
- Claude Code CLI installed (~/.local/bin/claude)
- ANTHROPIC_API_KEY with credits

# Setup
cd ~/src/ai/lilit
npm install
npx prisma db push   # or npx prisma migrate dev
npm run dev           # starts on port 51000

# DB
psql -U lilit -d lilit  # direct access

# .env
DATABASE_URL="postgresql://lilit:lilit@localhost:5434/lilit"
# App server port
PORT="51000"
# ANTHROPIC_API_KEY not needed — Claude Code CLI uses subscription auth
GOOGLE_GENERATIVE_AI_API_KEY="..."  # Gemini for PM/Architect/Summary
```

---

## 9. Test Projects

- `~/src/ai/lilit-test-app/` — Counter App (first test)
- `~/src/ai/lilit-test-app-2/` — To-Do List App (successful full pipeline test)

Test prompt that works: "Build a to-do list app with Next.js and localStorage"

---

## 10. Key Learnings

1. Claude Code CLI **must** use `--output-format text` (stream-json hangs from spawn)
2. Claude Code CLI uses **aliases** for models: `sonnet` not `claude-sonnet-4`
3. Prompts with special characters (backticks, $) **must** be passed via env vars, not `$(cat file)`
4. `--strict-mcp-config` with empty JSON **required** to prevent user's MCP servers from loading
5. `--permission-mode bypassPermissions` **required** for file access
6. QA agent installs Playwright + Chromium on first run (~2-3 min overhead)
7. Next.js Turbopack kills long-running child processes → need separate worker process
8. File-based log polling is more reliable than SSE for output streaming in Next.js dev
