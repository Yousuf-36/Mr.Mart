/**
 * Mr. Mart MCP Server — Stage 0 (mock data)
 *
 * Listens on port 3333 (configurable via MCP_PORT).
 * Exposes all MCP tools over Streamable HTTP transport per doc 11.
 *
 * Tool categories and their network exposure (doc 02 §1, doc 05 §2):
 *   READ    — public, Frontend calls these via Backend
 *   DECIDE  — public, Frontend calls these directly (owner approval tap)
 *   DRAFT   — registered but SYSTEM-ONLY; Worker calls internally
 *   EXECUTE — NOT registered on MCP transport; internal functions only
 *
 * Stage 0: all data is in-memory mock (see src/store/mock-store.ts).
 * Stage 1: mock-store is replaced by real Postgres queries.
 */

import "dotenv/config";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";

import { registerReadTools } from "./tools/read.js";
import { registerDecideTools } from "./tools/decide.js";
import { registerDraftTools } from "./tools/draft.js";

const PORT = parseInt(process.env.MCP_PORT ?? "3333", 10);

// ─── Express App ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// ─── Health check (used by Docker healthcheck + Backend startup probe) ────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "mrmart-mcp-server", stage: 0, timestamp: new Date().toISOString() });
});

// ─── MCP Server ──────────────────────────────────────────────────────────────
// Using per-request (stateless) transport as recommended for production HTTP deployments.
// Each POST to /mcp gets its own transport instance.

const transports: Map<string, StreamableHTTPServerTransport> = new Map();

app.post("/mcp", async (req, res) => {
  // Check for existing session
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports.has(sessionId)) {
    transport = transports.get(sessionId)!;
  } else if (!sessionId && isInitializeRequest(req.body)) {
    // New session
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport);
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) transports.delete(transport.sessionId);
    };

    // Build a new MCP server for this session
    const server = createMcpServer();
    await server.connect(transport);
  } else {
    res.status(400).json({ error: "Bad Request: missing or invalid session" });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

// SSE for GET /mcp (streaming responses)
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).json({ error: "No active session" });
    return;
  }
  await transports.get(sessionId)!.handleRequest(req, res);
});

// DELETE /mcp (session cleanup)
app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (sessionId && transports.has(sessionId)) {
    await transports.get(sessionId)!.handleRequest(req, res);
    transports.delete(sessionId);
  } else {
    res.status(404).json({ error: "Session not found" });
  }
});

// ─── Server factory ──────────────────────────────────────────────────────────
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "mrmart",
    version: "0.0.0",
  });

  // Register tool categories
  registerReadTools(server);
  registerDecideTools(server);
  registerDraftTools(server); // System-only: Worker calls these internally

  // NOTE: Execute tools are NOT registered here — they are plain functions
  // imported only by decide.ts (mrmart_approve_action). This enforces the
  // golden rule at the network level: execute tools have no HTTP endpoint.

  return server;
}

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Mr. Mart MCP server listening on http://localhost:${PORT}/mcp`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Stage: 0 (mock data — replace with real DB in Stage 1)`);
  console.log(`   Tools: read ✓  decide ✓  draft ✓  execute (internal only) ✓`);
});

process.on("unhandledRejection", (reason) => {
  console.error("[MCP Server] Unhandled rejection:", reason);
  process.exit(1);
});
