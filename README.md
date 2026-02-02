# Crew - AI Agent Orchestration Platform

A production-ready web app where you describe what you want built in natural language, and a team of AI agents (PM, Developer, QA) collaborate to produce working, tested code with real-time progress visible in the UI.

## ✨ Features (February 2026)

- ✅ **Full Pipeline**: PM-driven feedback loops with automatic retry
- ✅ **Real-Time Progress**: Live step indicators and agent output logs  
- ✅ **Cost Tracking**: Per-pipeline and per-agent cost tracking with budget limits
- ✅ **Settings Panel**: Project-specific model selection and configuration
- ✅ **Stack Auto-Detection**: Automatically detect Next.js, React, Python, Django, etc.
- ✅ **Budget Enforcement**: Automatic pipeline stop when budget exceeded
- ✅ **FREE Mode**: $0.00 per run using Claude CLI + Gemini Flash

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Set up database
createdb crew
npx prisma db push

# Configure (copy .env.example to .env)
cp .env.example .env

# Start dev server
npm run dev
```

See `.env.example` and `SPEC.md` for detailed setup instructions.

## 📊 Architecture

- **Frontend**: Next.js 16 + Tailwind CSS 4 + shadcn/ui
- **Backend**: PostgreSQL + Prisma 7
- **Agents**: Claude Code CLI (free via subscription) + Gemini API (free tier)
- **Runtime**: Separate worker processes for long-running pipelines

## 💰 Cost Optimization

**Recommended FREE setup:**
```env
PM_MODEL="gemini-2.5-flash"          # FREE
ARCHITECT_MODEL="gemini-2.5-flash"    # FREE  
DEVELOPER_MODEL="sonnet"              # FREE (Claude CLI subscription)
QA_MODEL="sonnet"                     # FREE (Claude CLI subscription)
```

**Result**: ~$0.00 per pipeline run! 🎉

See `.env.example` for advanced pricing configuration.

## 📖 Documentation

- `SPEC.md` - Technical specification and architecture
- `.env.example` - Environment variable documentation
- `test-prompts.md` - Example prompts for testing

## 🛠️ Key Components

| Component | Purpose |
|-----------|---------|
| `src/lib/orchestrator.ts` | Main pipeline router with PM-driven execution |
| `src/lib/agents.ts` | Agent definitions with role switching |
| `src/lib/cost-calculator.ts` | Model pricing and cost tracking |
| `src/lib/stack-detector.ts` | Auto-detect tech stack from files |
| `src/components/pipeline-steps.tsx` | Real-time step indicators |
| `src/components/cost-display.tsx` | Live cost tracking display |
| `src/components/settings-panel.tsx` | Project configuration UI |

## 🎯 Usage Example

```typescript
// 1. Create a project (auto-detects stack)
// 2. Send a request:
"Build a to-do list app with Next.js and localStorage"

// 3. Watch the pipeline:
// PM → Developer:code → Developer:review → QA:manual → Done
// Total cost: $0.00 | Time: ~8 minutes
```

## 🔧 Configuration

All settings are configurable via:
1. **Environment variables** (`.env`) - Global defaults
2. **Project settings** (UI) - Per-project overrides  
3. **Database** (Prisma) - Persistent storage

## 📝 License

MIT

---

**Built with ❤️ using Claude Code CLI**
