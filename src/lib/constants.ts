/**
 * Centralized constants — all magic numbers and strings in one place.
 * Import from `@/lib/constants` instead of using inline literals.
 *
 * Values already centralized elsewhere are NOT duplicated here:
 * - Model names, agent types, provider IDs → `@/lib/models`
 * - Pricing tables → `@/lib/cost-calculator` (labeled lookup with env override)
 * - Stack detection patterns → `@/lib/stack-detector` (domain logic)
 * - Convention file list → `@/lib/memory-ingestion` (domain list)
 */

import path from "path";

/** Resolved absolute path of the Lilit app root (computed once at import). */
export const CREW_APP_ROOT = path.resolve(process.cwd());

// ── Timeouts (ms) ───────────────────────────────────────────────────────────

/** Default timeout for a single Claude Code CLI execution (15 min).
 *  Health checks detect stale processes at TASK_STALE_THRESHOLD_MS (5 min);
 *  this is the hard kill for a CLI that is still producing output but never finishing. */
export const CLI_TIMEOUT_MS = 900_000;

/** Timeout for a single task execution in the PM decision loop (18 min).
 *  Slightly longer than CLI_TIMEOUT_MS so the CLI timeout fires first. */
export const TASK_EXECUTION_TIMEOUT_MS = 1_080_000;

/** How often the decision loop checks liveness while tasks run (30s). */
export const TASK_HEALTH_CHECK_INTERVAL_MS = 30_000;

/** If the log file hasn't been updated for this long, consider tasks stale (5 min). */
export const TASK_STALE_THRESHOLD_MS = 300_000;

/** Maximum wall-clock time for the entire worker process (25 min).
 *  Outermost safety net — kills the worker if the decision loop itself hangs. */
export const WORKER_TIMEOUT_MS = 1_500_000;

/** How long to wait for the user to confirm/reject a plan (10 min). */
export const PLAN_CONFIRMATION_TIMEOUT_MS = 600_000;

/** Polling frequency for plan confirmation file checks. */
export const PLAN_POLL_INTERVAL_MS = 1_000;

/** How often the CLI adapter checks for an abort flag. */
export const ABORT_CHECK_INTERVAL_MS = 3_000;

/** Grace period between SIGTERM and SIGKILL when aborting a CLI process. */
export const SIGKILL_DELAY_MS = 5_000;

/** How often the worker writes a heartbeat timestamp to PipelineRun.heartbeatAt. */
export const WORKER_HEARTBEAT_INTERVAL_MS = 60_000;

/** Pipeline GET auto-fails runs whose heartbeat is older than this (10 min). */
export const PIPELINE_STALE_THRESHOLD_MS = 600_000;

/** Fast-path stale threshold when the worker PID is confirmed dead (2 min). */
export const PIPELINE_DEAD_PID_THRESHOLD_MS = 120_000;

/** Delay before retrying a transient error on the same provider. */
export const TRANSIENT_RETRY_DELAY_MS = 2_000;

/** Timeout for a single embedding generation request. */
export const EMBEDDING_TIMEOUT_MS = 10_000;

/** Timeout for pulling a new embedding model via Ollama. */
export const MODEL_PULL_TIMEOUT_MS = 300_000;

/** Timeout for the Ollama health-check request. */
export const OLLAMA_HEALTH_CHECK_TIMEOUT_MS = 5_000;

/** UI polling interval for cost tracking during pipeline execution. */
export const COST_POLL_INTERVAL_MS = 10_000;

/** Refresh OAuth tokens this many ms before they expire (5 min). */
export const TOKEN_REFRESH_BUFFER_MS = 300_000;

/** Cooldown after an Antigravity account is rate-limited (1 min). */
export const RATE_LIMIT_COOLDOWN_MS = 60_000;

// ── Pipeline limits ─────────────────────────────────────────────────────────

/** Max attempts to execute a single agent (same provider + cross-provider). */
export const MAX_AGENT_ATTEMPTS = 3;

/** Number of recent events loaded for pipeline context. */
export const EVENT_HISTORY_LIMIT = 50;

/** Number of recent conversation messages included in context. */
export const CONVERSATION_HISTORY_LIMIT = 10;

// ── RAG / Memory limits ─────────────────────────────────────────────────────

/** Default number of memories to retrieve per RAG query. */
export const RAG_MEMORY_LIMIT = 8;

/** Minimum cosine similarity threshold for memory retrieval. */
export const RAG_MIN_SIMILARITY = 0.3;

/** Number of memories retrieved for standup overwatch prompts. */
export const STANDUP_RAG_LIMIT = 5;

/** Max opinion/preference signals extracted per agent run. */
export const MAX_SIGNALS_PER_RUN = 5;

/** Minimum length for an opinion pattern match to be kept. */
export const OPINION_MATCH_MIN_LENGTH = 10;

/** Maximum length for an opinion pattern match to be kept. */
export const OPINION_MATCH_MAX_LENGTH = 200;

/** Skip convention files larger than this (bytes). */
export const CONVENTION_FILE_MAX_SIZE = 10_000;

/** Truncation limit for memory content stored from convention files. */
export const MEMORY_CONTENT_MAX_LENGTH = 3_000;

// ── Truncation limits (prompt building) ─────────────────────────────────────

/** Preview length for assistant messages in conversation context. */
export const ASSISTANT_MESSAGE_PREVIEW_LENGTH = 800;

/** Max chars of code changes injected into review/fix prompts. */
export const CODE_CHANGES_PREVIEW_LENGTH = 5_000;

/** Max chars of issues injected into fix prompts. */
export const ISSUES_PREVIEW_LENGTH = 5_000;

/** Max chars of step output in summary generation. */
export const STEP_OUTPUT_SUMMARY_LENGTH = 500;

/** Max chars of own step results in standup prompts. */
export const OWN_STEP_RESULTS_LENGTH = 2_000;

/** Max chars of other agents' step results in standup prompts. */
export const OTHER_STEP_RESULTS_LENGTH = 1_500;

// ── Standup config ──────────────────────────────────────────────────────────

/** Max word count per standup overwatch message. */
export const STANDUP_MAX_WORDS = 200;

/** Max insights a single agent can produce in a standup. */
export const STANDUP_MAX_INSIGHTS_PER_AGENT = 3;

/** Max tokens for standup LLM generation. */
export const STANDUP_MAX_TOKENS = 1_024;

// ── Personality dynamics ────────────────────────────────────────────────────

export const PERSONALITY_INITIAL_TRUST = 0.5;
export const PERSONALITY_INITIAL_TENSION = 0.0;
export const PERSONALITY_INITIAL_RAPPORT = 0.5;

export const TRUST_BOOST_CLEAN_REVIEW = 0.05;
export const RAPPORT_BOOST_CLEAN_REVIEW = 0.01;
export const TRUST_DROP_REJECTED_REVIEW = 0.08;
export const TENSION_RISE_REJECTED_REVIEW = 0.10;
export const TRUST_BOOST_PASSING_TESTS = 0.05;
export const RAPPORT_BOOST_PASSING_TESTS = 0.01;
export const TRUST_DROP_FAILING_TESTS = 0.05;
export const TENSION_RISE_FAILING_TESTS = 0.08;
export const TRUST_BOOST_SUCCESSFUL_FIX = 0.03;
export const RAPPORT_BOOST_SUCCESSFUL_FIX = 0.01;
export const TENSION_DECAY_SMOOTH_PIPELINE = 0.02;
export const RAPPORT_BOOST_COLLABORATION = 0.01;
export const TENSION_DISPLAY_THRESHOLD = 0.3;
export const SCORE_HIGH_THRESHOLD = 0.7;
export const SCORE_NEUTRAL_THRESHOLD = 0.4;

// ── Significance scores ─────────────────────────────────────────────────────

export const SIGNIFICANCE_ARCHITECTURE = 0.9;
export const SIGNIFICANCE_PLAN_CREATED = 0.7;
export const SIGNIFICANCE_PLAN_REJECTED = 0.8;
export const SIGNIFICANCE_REVIEW_DONE = 0.6;
export const SIGNIFICANCE_FEEDBACK = 0.5;
export const SIGNIFICANCE_DEFAULT = 0.5;
export const SIGNIFICANCE_PERSONALITY = 0.4;
export const SIGNIFICANCE_CODE_PATTERN = 0.7;

// ── File paths & naming ─────────────────────────────────────────────────────

/** Name of the per-project temp directory under os.tmpdir(). */
export const TEMP_DIR_NAME = "lilit";

/** Filename for the live log file inside the project temp dir. */
export const LOG_FILENAME = "live.log";

/** Filename for the abort flag file. */
export const ABORT_FILENAME = "abort.flag";

/** Filename for the worker PID file. */
export const PID_FILENAME = "worker.pid";

/** Prefix for plan JSON files. */
export const PLAN_FILE_PREFIX = "plan-";

/** Prefix for plan confirmation JSON files. */
export const PLAN_CONFIRM_PREFIX = "plan-confirm-";

/** Prefix for prompt temp files written by the CLI adapter. */
export const PROMPT_FILE_PREFIX = "lilit-prompt-";

/** Prefix for message temp files written by the chat API route. */
export const MESSAGE_FILE_PREFIX = "lilit-msg-";

/** Filename for the empty MCP config written by the CLI adapter. */
export const EMPTY_MCP_FILENAME = "lilit-mcp-empty.json";

/** Filename for the Lilit tools MCP config written by the CLI adapter. */
export const LILIT_MCP_CONFIG_FILENAME = "lilit-mcp-tools.json";

/** Max tool-calling steps for SDK-based providers (Gemini, Claude API). */
export const MAX_TOOL_CALL_STEPS = 10;

/** Subdirectory name for voice audio files. */
export const VOICE_SUBDIR = "voice";

// ── External URLs ───────────────────────────────────────────────────────────

export const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const OAUTH_STATE_COOKIE = "antigravity_oauth_state";
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

// ── Embedding config ────────────────────────────────────────────────────────

export const EMBED_MODEL = "nomic-embed-text";

// ── Voice / TTS config ──────────────────────────────────────────────────────

export const TTS_MODEL = "tts-1";
export const TTS_DEFAULT_SPEED = 1.0;
export const TTS_RESPONSE_FORMAT = "mp3";
export const WORDS_PER_MINUTE = 150;

// ── Log display ─────────────────────────────────────────────────────────────

/** Length of separator lines in log output (e.g. "=".repeat(60)). */
export const LOG_SEPARATOR_LENGTH = 60;

/** Min repeated chars to detect a line as a separator in log highlighting. */
export const LOG_SEPARATOR_DETECT_LENGTH = 10;

// ── localStorage keys ──────────────────────────────────────────────────────

export const ACTIVE_PROJECT_KEY = "lilit-active-project";
export const SPLASH_SEEN_KEY = "lilit-splash-seen";
export const SIDEBAR_COLLAPSED_KEY = "lilit-sidebar-collapsed";
export const SHOW_LOG_KEY = "lilit-show-log";
export const ENHANCED_LOG_KEY = "lilit-enhanced-log";
export const DISMISSED_RUN_KEY_PREFIX = "lilit-dismissed-run-";

// ── Debate system ─────────────────────────────────────────────────────────

/** Maximum back-and-forth turns in a single debate. */
export const DEBATE_MAX_TURNS = 3;

/** Maximum debates triggered per pipeline step. */
export const DEBATE_MAX_PER_STEP = 2;

/** Maximum debates triggered per entire pipeline run. */
export const DEBATE_MAX_PER_RUN = 6;

/** Minimum remaining budget (USD) required to start a debate. */
export const DEBATE_MIN_BUDGET_REMAINING = 0.50;

/** Max tokens per debate turn LLM call. */
export const DEBATE_TURN_MAX_TOKENS = 512;

/** Keyword-match confidence threshold for triggering a debate. */
export const DEBATE_KEYWORD_CONFIDENCE_THRESHOLD = 0.5;

/** Semantic similarity confidence threshold for debate triggers (future). */
export const DEBATE_SEMANTIC_CONFIDENCE_THRESHOLD = 0.6;

/** Multiplier applied to debate threshold when tension is high (lowers threshold). */
export const DEBATE_TENSION_MULTIPLIER = 0.8;

/** Multiplier applied to debate threshold when rapport is high (raises threshold). */
export const DEBATE_RAPPORT_MULTIPLIER = 1.2;

/** Max chars of step output included in debate prompts. */
export const DEBATE_OUTPUT_SNIPPET_LENGTH = 2_000;

/** Max chars per debate turn content. */
export const DEBATE_TURN_MAX_LENGTH = 500;

/** Number of past debate memories to include in debate context. */
export const DEBATE_RAG_LIMIT = 3;

// Debate significance scores
export const SIGNIFICANCE_DEBATE_REVISED = 0.85;
export const SIGNIFICANCE_DEBATE_ACCEPTED = 0.6;
export const SIGNIFICANCE_DEBATE_COMPROMISE = 0.75;
export const SIGNIFICANCE_DEBATE_ESCALATED = 0.8;

// Debate relationship adjustments
export const TENSION_RISE_DEBATE_CHALLENGE = 0.05;
export const TENSION_DROP_DEBATE_CONCEDE = 0.03;
export const RAPPORT_BOOST_DEBATE_COMPROMISE = 0.04;
export const TRUST_BOOST_DEBATE_ACCEPTED = 0.02;
export const TRUST_DROP_DEBATE_ESCALATED = 0.03;

// ── Personality bootstrap ─────────────────────────────────────────────────

/** Max tokens for personality self-bootstrap LLM call. */
export const PERSONALITY_BOOTSTRAP_MAX_TOKENS = 1_024;

/** Significance score for bootstrapped personality memories in RAG. */
export const PERSONALITY_MEMORY_SIGNIFICANCE = 0.9;

// ── Dynamic orchestration (PM decision loop) ────────────────────────────────

/** Max tasks executing concurrently during PM decision loop. */
export const MAX_PARALLEL_TASKS = 3;

/** Safety valve: max PM decision cycles per pipeline run. */
export const MAX_PM_DECISIONS_PER_RUN = 50;

/** Timeout for a single PM decision call. */
export const PM_DECISION_TIMEOUT_MS = 60_000;

/** How often the decision loop checks for user messages. */
export const USER_MESSAGE_POLL_INTERVAL_MS = 2_000;

/** Prefix for user message files sent during pipeline execution. */
export const USER_MESSAGE_FILE_PREFIX = "user-msg-";

/** Prefix for PM question files awaiting user response. */
export const PM_QUESTION_FILE_PREFIX = "pm-question-";

/** Timeout for waiting on a user response to a PM question (10 min). */
export const PM_QUESTION_TIMEOUT_MS = 600_000;

/** Max chars of task output included in PM decision context summaries. */
export const TASK_OUTPUT_SUMMARY_LENGTH = 500;

// ── Stream-JSON (Claude Code CLI) ────────────────────────────────────────────

/** Event type strings emitted by `claude -p --output-format stream-json`. */
export const STREAM_EVENT_SYSTEM = "system";
export const STREAM_EVENT_ASSISTANT = "assistant";
export const STREAM_EVENT_TOOL = "tool";
export const STREAM_EVENT_RESULT = "result";

/** System-event subtypes that carry no useful content for logs. */
export const STREAM_FILTERED_SUBTYPES: ReadonlySet<string> = new Set([
  "hook_started",
  "hook_response",
]);

/** Emoji prefix for tool-use activity lines in the log. */
export const TOOL_USE_LOG_PREFIX = "🔧";

// ── Misc ────────────────────────────────────────────────────────────────────

export const TOKENS_PER_MILLION = 1_000_000;
export const COST_DISPLAY_PRECISION_THRESHOLD = 0.01;
export const MIN_OUTPUT_LENGTH_FOR_SIGNALS = 50;
export const SUMMARY_MAX_WORDS = 400;

// ── Team chat window ──────────────────────────────────────────────────────

/** Polling interval for real-time agent messages in team chat window. */
export const TEAM_CHAT_POLL_INTERVAL_MS = 2_000;

/** Default width of the floating team chat window (px). */
export const TEAM_CHAT_DEFAULT_WIDTH = 420;

/** Default height of the floating team chat window (px). */
export const TEAM_CHAT_DEFAULT_HEIGHT = 480;

/** Minimum width the team chat window can be resized to (px). */
export const TEAM_CHAT_MIN_WIDTH = 320;

/** Minimum height the team chat window can be resized to (px). */
export const TEAM_CHAT_MIN_HEIGHT = 280;

/** Maximum width the team chat window can be resized to (px). */
export const TEAM_CHAT_MAX_WIDTH = 800;

/** Maximum height the team chat window can be resized to (px). */
export const TEAM_CHAT_MAX_HEIGHT = 900;

/** localStorage key for team chat window position/size/state. */
export const TEAM_CHAT_STATE_KEY = "lilit-team-chat-state";

/** Maximum number of agent messages to fetch per poll. */
export const TEAM_CHAT_MESSAGE_LIMIT = 200;

// ── Query limits ────────────────────────────────────────────────────────────

/** Default pagination limit for project listing queries. */
export const PROJECT_LIST_LIMIT = 100;

/** Default pagination limit for agent run cost queries. */
export const COST_QUERY_LIMIT = 1000;

/** Number of past pipeline runs to return alongside the active run. */
export const PAST_RUNS_LIMIT = 10;

/** Maximum length of worker stderr output logged per chunk. */
export const WORKER_STDERR_MAX_LENGTH = 500;

/** Page size for cursor-based chat message pagination. */
export const CHAT_MESSAGE_PAGE_SIZE = 50;

/** Page size for agent message backward pagination. */
export const AGENT_MESSAGE_PAGE_SIZE = 100;

/** Max chars of log content persisted to PipelineRun.logContent on completion. */
export const LOG_CONTENT_MAX_LENGTH = 500_000;

/** Max tasks fetched per pipeline run query. */
export const TASKS_PER_RUN_LIMIT = 200;

/** Max standup messages fetched for trend analysis. */
export const STANDUP_TRENDS_LIMIT = 500;

/** Max active pipeline runs returned by the active indicator endpoint. */
export const ACTIVE_PIPELINE_LIMIT = 50;

/** Max inbox messages fetched per agent per pipeline run. */
export const INBOX_MESSAGE_LIMIT = 200;
