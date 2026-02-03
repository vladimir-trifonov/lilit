# CLAUDE.md

Project-level context for AI assistants working on the Lilit codebase.

## What is Lilit

Lilit is an AI-powered software development team orchestration platform. Users describe what needs to be built, and a team of autonomous AI agents (PM, Architect, Developer, QA) collaborates to plan, implement, review, and test the changes. It is a Next.js web app backed by PostgreSQL.

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack), React 19, TypeScript 5
- **Styling**: Tailwind CSS 4, Shadcn UI components (in `src/components/ui/`)
- **Database**: PostgreSQL 17 via Prisma 7 with `@prisma/adapter-pg` (PrismaPg driver adapter)
- **AI Providers**: Anthropic Claude (via Claude Code CLI) and Google Gemini (via `@ai-sdk/google` + Vercel AI SDK)
- **UI Components**: ElevenLabs UI (`@elevenlabs/ui`) -- animated components for agent/audio UIs (ShimmeringText, Orb, BarVisualizer, Response)
- **Runtime**: Node.js 22 (Docker), Bun-compatible (`bunx tsx` for worker spawn)
- **Package Manager**: npm (lockfile is `package-lock.json`)

## Commands

```bash
make setup         # npm install + docker compose up + prisma db push
make dev           # docker compose up + npm run dev
make stop          # docker compose down
make build         # npm run build (next build)
make lint          # npm run lint (eslint)
make typecheck     # npx tsc --noEmit
make db-reset      # wipe DB volume + recreate + prisma db push
make clean-all     # docker compose down -v --rmi all
```

### Prisma

```bash
npx prisma migrate dev --name <name>   # create + apply migration
npx prisma generate                     # regenerate client after schema changes
npx prisma db push                      # push schema without migration (dev only)
```

After any `schema.prisma` change, always run `npx prisma generate` before building. The build will fail on stale client types.

## Project Structure

```
src/
  app/
    api/                  # Next.js API routes (REST, all in route.ts files)
      abort/              # POST - abort active pipeline
      agents/             # GET - list available agents
      browse/             # POST - browser automation
      chat/               # POST - submit message, GET - conversation history
      costs/              # GET - cost tracking per project or conversation
      logs/               # GET - live log streaming (file poll)
      pipeline/           # GET/POST - pipeline run status, resume
        active/           # GET - list projects with running pipelines
      plan/               # GET/POST - plan confirmation gate
      projects/           # CRUD + detect-stack + validate
      providers/          # GET - available AI providers
      settings/           # GET/PUT - project settings
    page.tsx              # Main SPA entry point
    layout.tsx            # Root layout
    globals.css           # Tailwind imports + CSS variables
  components/
    ui/                   # Shadcn primitives (button, badge, card, input, etc.)
    chat.tsx              # Main chat interface
    enhanced-log-panel.tsx  # Live log viewer with collapsible sections
    pipeline-steps.tsx    # Pipeline step progress display
    plan-confirmation.tsx # Plan approval modal
    settings-panel.tsx    # Budget + model settings UI
    agents-panel.tsx      # Agent status cards
    project-selector.tsx  # Sidebar project list
    new-project-form.tsx  # Create project form
    cost-display.tsx      # Cost tracker widget
  lib/
    orchestrator.ts       # Central routing engine (PM -> plan -> confirm -> execute)
    claude-code.ts        # Claude Code CLI wrapper (execSync)
    llm.ts                # Google Gemini API wrapper (@ai-sdk/google)
    agent-loader.ts       # Loads agent definitions from agents/ markdown files
    skills.ts             # Loads skill definitions from skills/ markdown files
    providers.ts          # Runtime provider detection (Claude CLI, Gemini API key)
    models.ts             # Model name constants (single source of truth)
    cost-calculator.ts    # Token -> USD pricing tables
    event-log.ts          # Append-only event log (DB-backed)
    plan-gate.ts          # File-based plan confirmation polling
    stack-detector.ts     # Auto-detect project tech stack from filesystem
    worker.ts             # Child process spawned from /api/chat
    prisma.ts             # Prisma client singleton (PrismaPg adapter)
    log-highlighter.ts    # Log syntax highlighting utilities
    log-parser.ts         # Parse log content into pipeline steps
    utils.ts              # Shared utilities
  types/
    settings.ts           # ProjectSettings, AgentSettings types
    pipeline.ts           # PipelineStep, StepStatus types

agents/                   # Agent definitions (markdown with YAML frontmatter)
  pm/AGENT.md             # Project manager - plans and delegates
  architect/AGENT.md      # Architecture decisions
  developer/
    AGENT.md              # Developer base agent
    roles/                # Sub-role overrides
      code.md             # Writing code
      review.md           # Code review
      fix.md              # Bug fixing
      devops.md           # Infrastructure
  qa/
    AGENT.md              # QA base agent
    roles/
      automation.md       # Automated testing
      manual.md           # Browser/manual testing

skills/                   # Skill definitions (markdown with YAML frontmatter)
  react-best-practices/   # React performance patterns
  next-best-practices/    # Next.js patterns
  modern-python/          # Python best practices
  static-analysis/        # CodeQL/Semgrep security scanning
  differential-review/    # Security-focused code review
  insecure-defaults/      # Security vulnerability patterns
  composition-patterns/   # Software design patterns
  webapp-testing/         # Testing strategies

prisma/
  schema.prisma           # Database schema
  migrations/             # SQL migration history
  config is in prisma.config.ts (root)
```

## Architecture Patterns

### Agent System

Agents are defined as markdown files in `agents/{type}/AGENT.md` with YAML frontmatter (name, type, description, provider, model, capabilities, tags). The body is the system prompt. Sub-roles live in `agents/{type}/roles/{role}.md` and inherit from the parent agent.

`agent-loader.ts` scans the directory, caches the registry, and provides `getSystemPrompt(type, role)` and `getProviderConfig(type, role)`.

### Skill System

Skills are markdown files in `skills/{name}/SKILL.md` with YAML frontmatter (name, description, tags, agents). Skills are matched to agents by tag overlap (stack tags like "nextjs", role tags like "review"). The PM can also explicitly assign skills per task.

At execution time, `swapProjectSkills()` copies matched skill files into the target project's `.claude/skills/` directory so the Claude Code CLI picks them up.

### Orchestration Flow

1. User sends message via `/api/chat` POST
2. API spawns a worker process (`bunx tsx worker.ts`)
3. Worker calls `orchestrate()` which:
   - Asks PM agent to generate an execution plan (tasks + pipeline)
   - Writes plan file and waits for user confirmation (file-based polling via `plan-gate.ts`)
   - On confirmation, executes each pipeline step sequentially
   - Each step resolves agent + model + skills, then calls `runClaudeCode()` or `runLLM()`
   - On QA/review failure, PM re-evaluates and injects fix steps (max 3 cycles)
   - After pipeline completes, generates a summary
4. Worker writes result JSON to stdout; API reads it

### Provider Resolution Chain

Model selection follows this priority (highest to lowest):
1. Project settings override (user-configured per agent/role in UI)
2. PM plan task-level hint (model/provider in plan JSON)
3. Role `.md` frontmatter
4. Agent `.md` frontmatter
5. Auto-fallback to first available provider

### Inter-Process Communication

- **Worker spawn**: API route spawns `bunx tsx worker.ts` with args `[projectId, conversationId, msgFilePath, runId]`
- **User message**: Written to temp file, path passed as argv (not the message itself)
- **Live logs**: Worker writes to `/tmp/lilit/{projectId}/live.log`, UI polls `/api/logs`
- **Plan confirmation**: File-based polling in `/tmp/lilit/{projectId}/plan-*.json`
- **Abort**: Write flag file at `/tmp/lilit/{projectId}/abort.flag`, kill worker PID

### Cost Tracking

`AgentRun` records are linked to `PipelineRun` via `pipelineRunId` FK. The costs API queries runs by pipeline run, not by time window. Pricing tables in `cost-calculator.ts` can be overridden with `PRICING_{MODEL}_INPUT` / `PRICING_{MODEL}_OUTPUT` env vars.

## Database

PostgreSQL 17 on port 5434 (host) / 5432 (container). Connection via `DATABASE_URL` env var.

**Models**: Project, Conversation, Message, AgentRun, EventLog, PipelineRun

Key relationships:
- Project has many Conversations, AgentRuns, EventLogs, PipelineRuns
- PipelineRun has many AgentRuns (via `pipelineRunId` FK)
- Conversation has many Messages

`PipelineRun.status` values: `running`, `awaiting_plan`, `completed`, `failed`, `aborted`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (default: `postgresql://lilit:lilit@localhost:5434/lilit`) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | No | Enables Gemini provider; without it, only Claude Code CLI is available |
| `DEFAULT_BUDGET_LIMIT` | No | Default budget per pipeline run in USD (default: `10.0`) |
| `PRICING_{MODEL}_INPUT` | No | Override input token pricing for a model |
| `PRICING_{MODEL}_OUTPUT` | No | Override output token pricing for a model |
| `AUTH_SECRET` | No | Shared secret for API auth. When set, all `/api/` routes require `Authorization: Bearer <secret>` |
| `TOKEN_ENCRYPTION_KEY` | No | 64 hex char (32-byte) key for AES-256-GCM encryption of OAuth tokens at rest |

## Coding Conventions

- **TypeScript strict mode** is enabled. All code must pass `tsc --noEmit`.
- **ESLint** uses flat config (`eslint.config.mjs`) with `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`. Zero warnings policy.
- **No unused variables or imports** -- ESLint enforces `@typescript-eslint/no-unused-vars`. Remove unused code rather than prefixing with `_`.
- **Path aliases**: `@/*` maps to `./src/*` (configured in `tsconfig.json`).
- **Components**: React client components use `"use client"` directive. Server components are the default.
- **API routes**: All in `src/app/api/{name}/route.ts` using Next.js App Router conventions. Export `dynamic = "force-dynamic"` for non-static routes.
- **Prisma client**: Import from `@/lib/prisma`. Singleton pattern with `globalThis` caching in dev.
- **Model constants**: Import from `@/lib/models` (client-safe) or `@/lib/providers` (server-side, re-exports models + adds runtime detection).
- **Agent/Skill files**: Markdown with YAML frontmatter. Body is the system prompt. Parsed by `agent-loader.ts` and `skills.ts` using `js-yaml`.
- **JSX entities**: Use HTML entities (`&ldquo;`, `&rdquo;`, `&quot;`) instead of literal quotes in JSX text content.
- **Error handling**: Use empty `catch {}` blocks only for truly ignorable filesystem operations. API routes should return proper error responses.
- **Settings**: Stored as JSON string in `Project.settings` column. Parsed via `parseSettings()` from `@/types/settings`.
- **No magic numbers or strings**: All numeric constants (timeouts, limits, thresholds, scores) and string constants (file paths, URLs, directory names) must be defined in `src/lib/constants.ts` with descriptive names. Import from `@/lib/constants` rather than using inline literals. Exceptions: `0`, `1`, `-1` in trivial comparisons/indices, HTTP status codes in API route responses, and values already centralized in `models.ts` or domain-specific lookup tables.
- **No hardcoded model names in adapters**: Provider adapters must not duplicate model names in local lookup tables or mappings. Model lists live in `@/lib/models` (single source of truth). Adapters should derive API-specific model IDs programmatically (e.g. stripping a prefix) rather than maintaining a parallel map. Pricing in `cost-calculator.ts` must gracefully handle unknown models (return zero), so adding a new model to `models.ts` is the only required change.
- **API route request body parsing**: Always wrap `await req.json()` in a try/catch block and return a 400 response on parse failure. Never let malformed JSON propagate as an unhandled exception.
- **DB query pagination**: Every `findMany` call must include a `take` limit. Use constants from `@/lib/constants` (`PROJECT_LIST_LIMIT`, `COST_QUERY_LIMIT`, etc.). Unbounded queries exhaust memory over time.
- **Input validation before filesystem ops**: User-supplied IDs used in file paths (e.g. `projectId`) must be validated with a strict regex (`/^[a-zA-Z0-9_-]+$/`) before any `path.join`, `fs.readFileSync`, or `fs.writeFileSync`. Use `getProjectDir()` from `@/lib/claude-code` which includes this validation.
- **No shell exec with user-derived values**: Use `process.kill(pid)` instead of `execSync("kill ...")`. Validate PIDs as integers. Never interpolate user input into shell commands.
- **Raw SQL safety**: When using `$queryRawUnsafe`, always use positional parameters (`$1`, `$2`). Validate inputs before constructing query strings -- e.g. check `Number.isFinite()` on all embedding values before building vector strings.
- **Child process output**: Truncate stderr output from worker processes before logging to prevent sensitive data (API keys, tokens) from appearing in server logs. Use `WORKER_STDERR_MAX_LENGTH` from constants.

### Shared Utilities (use these, don't re-implement)

| Utility | Location | Use for |
|---------|----------|---------|
| `extractJSON(raw)` | `@/lib/utils` | Parsing JSON from LLM output (3-stage: direct parse, code fence, find object/array) |
| `clamp(value, min, max)` | `@/lib/utils` | Bounding numeric values |
| `apiFetch(path, opts)` | `@/lib/utils` | Client-side API calls (attaches AUTH_SECRET bearer token) |
| `authHeaders()` | `@/lib/utils` | Server-side auth header construction |
| `getCodename(agentType)` | `@/lib/personality` | Resolving agent type to display codename (falls back to agent type) |
| `stepLabel(step)` | `@/lib/orchestrator` | Formatting `agent:role` or `agent` labels for pipeline steps |
| `getProjectDir(projectId)` | `@/lib/claude-code` | Getting validated project temp directory path |
| `PlaybackButton` | `@/components/playback-button` | Voice playback toggle button (used in standup and agent message threads) |

### Types (canonical sources, don't redefine)

| Type | Location | Notes |
|------|----------|-------|
| `StepInfo` | `@/types/pipeline` | Canonical pipeline step info. Extend with `interface MyStepInfo extends StepInfo { ... }` if you need extra fields (e.g. required `output`). |
| `PipelineStep` | `@/types/pipeline` | Pipeline step with status enum |
| `ProjectSettings` | `@/types/settings` | Full project settings shape |

### React Patterns

- **Always check `res.ok`** on fetch responses before updating component state. `fetch` only rejects on network failure -- 4xx/5xx are successful responses that must be handled explicitly.
- **Sync state from props**: When a component takes an `initialX` prop and manages local state, add a `useEffect` to sync when the prop changes. Otherwise UI drifts from server state.
- **Stable keys**: Use domain-meaningful keys (e.g. `\`${theme}-${insightType}\``) in `.map()` calls, not array indices. Index keys cause unnecessary remounts when items reorder.

## Design System

Full reference: `docs/DESIGN-SYSTEM.md`. Key rules for writing UI code:

### Color Tokens (OKLCH)

Use CSS custom properties -- never hardcode Tailwind color classes like `zinc-*`, `yellow-*`, `amber-*`, `green-*`.

| Token | Usage |
|-------|-------|
| `--brand` / `--brand-soft` / `--brand-muted` | Primary interactive, focus rings, active states |
| `--accent` / `--accent-soft` | Secondary emphasis, gradient endpoints |
| `--background` | App canvas (near-black, faint blue undertone) |
| `--surface` | Cards, panels, elevated surfaces |
| `--surface-raised` | Modals, popovers, dropdowns |
| `--sidebar` | Sidebar background |
| `--border` / `--border-subtle` | Borders and dividers |
| `--foreground` / `--muted-foreground` / `--faint` | Primary / secondary / tertiary text |
| `--success` / `--warning` / `--destructive` / `--info` | Status colors (each has a `-soft` variant at ~12% opacity for backgrounds) |

**Agent identity colors** (for avatars, activity indicators, standup attribution):
- PM (Sasha): `oklch(0.65 0.15 270)` -- indigo
- Architect (Marcus): `oklch(0.60 0.12 200)` -- sky blue
- Developer (Kai): `oklch(0.65 0.18 155)` -- emerald
- QA (River): `oklch(0.65 0.15 45)` -- amber

### Glass Material (Liquid Glass)

Three Tailwind utilities defined in `globals.css`:

| Utility | Where to use |
|---------|-------------|
| `glass-subtle` | Sidebar, header bar |
| `glass` | Cards, panels, log sections |
| `glass-raised` | Modals, settings panel, agent panel |

**Do not** apply glass to badges, chips, or buttons. Max 3 glass surfaces visible simultaneously. Never animate an element with `backdrop-filter` directly.

### Surface Hierarchy

```
Level 0: --background     (chat scroll area, main canvas)
Level 1: glass-subtle/glass (sidebar, header, cards, panels)
Level 2: glass-raised      (modals, popovers -- use shadow-2xl shadow-black/20 + backdrop-blur-sm overlay)
```

### Component Patterns

- **Cards**: `glass border border-border-subtle rounded-xl p-4`
- **Modals**: `glass-raised border border-border rounded-xl shadow-2xl shadow-black/20 backdrop-blur-sm`
- **Badges**: `rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide` with `bg-{status}-soft text-{status}`
- **Buttons**: Primary `bg-brand text-white hover:bg-brand/90`, Secondary `bg-surface border border-border`, Ghost `text-muted-foreground hover:text-foreground hover:bg-muted`
- **Inputs**: `bg-surface border border-border rounded-lg focus:border-brand focus:ring-2 focus:ring-brand/20 placeholder:text-faint`
- **Pipeline steps**: Running `bg-brand-soft border-brand text-brand` + breathe animation, Done `bg-success-soft`, Failed `bg-destructive-soft`, Pending `bg-muted`

### Typography

- Body/labels: Geist Sans, 14px (`text-sm`), weight 400-600
- Secondary: 13px (`text-[13px]`), `--muted-foreground`
- Captions: 12px (`text-xs`), `--faint`
- Code/logs: Geist Mono, 13px
- Badges: 11px (`text-[11px]`), weight 500, wide tracking

### Motion

- Spring easing (`--spring-bounce`, `--spring-snappy`) for interactive elements (buttons, modals, panels)
- `ease-out` for opacity/color transitions only
- Breathing animation (4-6s infinite) for running indicators
- All motion must respect `prefers-reduced-motion`

### Gradients

Reserved for emphasis moments only: splash shimmer, active project border, decorative dividers, ambient backdrop. **Never** for button fills, card backgrounds, or text (except splash title).

## Common Pitfalls

- After changing `prisma/schema.prisma`, you must run `npx prisma generate` before `next build`. The build uses generated types.
- The worker process is spawned with `bunx tsx` -- ensure `tsx` is available. In Docker, it comes from the npm install.
- Claude Code CLI must be authenticated on the host. Docker mounts `~/.claude` read-only into the container.
- `execSync` in `claude-code.ts` has a 30-minute default timeout. Long pipelines can hit this.
- The plan confirmation gate uses filesystem polling (not WebSockets). Files live in `/tmp/lilit/{projectId}/`.
- Model names passed to the CLI are validated against `/^[a-zA-Z0-9._:/-]+$/` to prevent shell injection.

## Troubleshooting

### Pipeline step appears stuck

After `[agent:role] Started` appears in logs, the Claude Code CLI runs in `-p` (print) mode with `--output-format text`. Output is buffered until the agent finishes, so silence in the logs is normal. The UI shows a shimmering "Still working..." indicator on running sections in the log panel and pipeline steps.

**Check if the Claude process is still running:**

```bash
ps aux | grep "claude.*-p"
```

**Check if the log file is growing:**

```bash
ls -la /tmp/lilit/*/live.log
```

**Tail the live log directly:**

```bash
# Replace <projectId> with your project's UUID
tail -f /tmp/lilit/<projectId>/live.log
```

**Check the worker process:**

```bash
ps aux | grep "worker.ts"
```

**Check for abort flag:**

```bash
ls -la /tmp/lilit/<projectId>/abort.flag
```

### Common stuck scenarios

- **Agent waiting for API**: Claude Code CLI can take minutes on complex prompts. The 30-minute timeout will eventually kill it.
- **Process zombie**: If `ps aux | grep claude` shows no process but the pipeline hasn't progressed, the worker may have crashed. Check `docker logs` or the Next.js dev server output.
- **Plan gate stuck**: If the status shows `awaiting_plan`, check `/tmp/lilit/<projectId>/plan-*.json` for the pending plan file. The UI polls `/api/plan` to show the confirmation modal.
