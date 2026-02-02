# Lilit

Describe what you want built, and a team of AI agents (PM, Developer, QA) collaborates to produce working, tested code. Real-time progress, cost tracking, plan confirmation before execution.

## Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- [Docker](https://docs.docker.com/get-docker/) (for PostgreSQL)
- Node.js 20+
- (Optional) [Google AI API key](https://aistudio.google.com/apikey) for Gemini models

## Setup

```bash
cp .env.example .env   # edit with your keys
make setup             # install deps, start postgres, push schema
make dev               # start the app
```

Open [http://localhost:3000](http://localhost:3000), create a project pointing to a directory, and send a message.

## How it works

1. You send a message describing what to build
2. **PM** creates an execution plan (you approve/reject it)
3. Pipeline executes: Architect, Developer (code/review/fix), QA (automation/manual)
4. Failures trigger automatic PM re-evaluation and fix cycles (up to 3)
5. Summary delivered back to the UI

Agents are defined as markdown files in `agents/` with YAML frontmatter. Edit them from the UI (Agents button) or directly on disk.

## Makefile

```
make setup      # install + docker + prisma
make dev        # start docker + next dev
make stop       # stop docker
make db-reset   # wipe and recreate database
make build      # production build
make typecheck  # tsc --noEmit
make lint       # eslint
```

## Cost

Default config costs $0.00/run: Claude CLI (subscription) for Developer/QA, Gemini free tier for PM/Architect. Configure per-agent models in Settings or via env vars.
