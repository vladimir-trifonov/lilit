# CLAUDE.md

Project-level context for AI assistants working on the Lilit codebase.

## What is Lilit

Lilit is an AI-powered software development team orchestration platform. Users describe what needs to be built, and a team of autonomous AI agents (PM, Architect, Developer, QA) collaborates to plan, implement, review, and test the changes. It is a Next.js web app backed by PostgreSQL.

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack), React 19, TypeScript 5
- **Styling**: Tailwind CSS 4, Shadcn UI components (in `src/components/ui/`)
- **Database**: PostgreSQL 17 via Prisma 7 with `@prisma/adapter-pg` (PrismaPg driver adapter)
- **AI Providers**: Anthropic Claude (via Claude Code CLI) and Google Gemini (via `@ai-sdk/google` + Vercel AI SDK)
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

## Common Pitfalls

- After changing `prisma/schema.prisma`, you must run `npx prisma generate` before `next build`. The build uses generated types.
- The worker process is spawned with `bunx tsx` -- ensure `tsx` is available. In Docker, it comes from the npm install.
- Claude Code CLI must be authenticated on the host. Docker mounts `~/.claude` read-only into the container.
- `execSync` in `claude-code.ts` has a 30-minute default timeout. Long pipelines can hit this.
- The plan confirmation gate uses filesystem polling (not WebSockets). Files live in `/tmp/lilit/{projectId}/`.
- Model names passed to the CLI are validated against `/^[a-zA-Z0-9._:/-]+$/` to prevent shell injection.
