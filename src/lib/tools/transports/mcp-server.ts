#!/usr/bin/env node
/**
 * MCP Server for Lilit agent tools.
 *
 * Spawned by the Claude Code CLI as a child process. Communicates over
 * stdin/stdout using the MCP protocol (JSON-RPC 2.0).
 *
 * Usage: bunx tsx mcp-server.ts
 * Environment: LILIT_PROJECT_ID must be set (passed by the CLI adapter)
 *              DATABASE_URL must be set (inherited from parent process)
 *
 * Protocol: https://modelcontextprotocol.io/specification
 */

import { getAllToolDefinitions, executeTool } from "../registry";

const PROJECT_ID = process.env.LILIT_PROJECT_ID ?? "";
const PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "lilit-tools";
const SERVER_VERSION = "1.0.0";

// ── JSON-RPC types ──────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ── Handlers ────────────────────────────────────────────────────────────────

function handleInitialize(): unknown {
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
  };
}

function handleToolsList(): unknown {
  const definitions = getAllToolDefinitions();
  return {
    tools: definitions.map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
    })),
  };
}

async function handleToolsCall(params: Record<string, unknown>): Promise<unknown> {
  const name = params.name as string;
  const args = (params.arguments ?? {}) as Record<string, unknown>;

  const result = await executeTool(name, PROJECT_ID, args);
  const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);

  return {
    content: [{ type: "text", text }],
  };
}

// ── Message dispatch ────────────────────────────────────────────────────────

async function handleMessage(msg: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const { id, method, params } = msg;

  // Notifications (no id) don't get responses
  if (id === undefined) {
    // "notifications/initialized" is expected after initialize — just acknowledge
    return null;
  }

  try {
    let result: unknown;

    switch (method) {
      case "initialize":
        result = handleInitialize();
        break;
      case "tools/list":
        result = handleToolsList();
        break;
      case "tools/call":
        result = await handleToolsCall(params ?? {});
        break;
      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
    }

    return { jsonrpc: "2.0", id, result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: msg },
    };
  }
}

// ── Stdio transport ─────────────────────────────────────────────────────────

function sendResponse(response: JsonRpcResponse): void {
  const json = JSON.stringify(response);
  process.stdout.write(json + "\n");
}

let buffer = "";

process.stdin.setEncoding("utf-8");
process.stdin.on("data", async (chunk: string) => {
  buffer += chunk;

  // Process complete lines (newline-delimited JSON)
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const msg = JSON.parse(trimmed) as JsonRpcRequest;
      const response = await handleMessage(msg);
      if (response) sendResponse(response);
    } catch {
      // Malformed JSON — send parse error
      sendResponse({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
    }
  }
});

process.stdin.on("end", () => {
  process.exit(0);
});

// Keep process alive
process.stdin.resume();
