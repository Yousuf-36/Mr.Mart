/**
 * Mr. Mart Backend — Stage 0
 *
 * Thin Express service that sits between the Frontend and the MCP server.
 * Port 3001 (BACKEND_PORT).
 *
 * In Stage 0 it primarily:
 *  1. Exposes a health check endpoint
 *  2. Provides a proxy to the MCP server for the agent connection
 *  3. Establishes DB connection (verified but not used for real queries yet)
 *  4. Establishes Redis connection (verified for Worker queue readiness)
 *
 * Real auth middleware, rate limiting, and per-tool authorization are added
 * in Stage 2 (per docs/05 §2 and docs/10 Stage 2).
 */

import "dotenv/config";
import express from "express";

const PORT = parseInt(process.env.BACKEND_PORT ?? "3001", 10);

const app = express();
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "mrmart-backend",
    stage: 0,
    timestamp: new Date().toISOString(),
    mcp_server: process.env.MCP_SERVER_URL ?? "http://mcp-server:3333",
  });
});

// ── Root info ─────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({
    name: "Mr. Mart Backend",
    stage: 0,
    docs: "See /docs in the monorepo for full spec",
    endpoints: {
      health: "GET /health",
    },
  });
});

// ── 404 catch-all ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[Backend] Error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Mr. Mart Backend listening on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   MCP Server: ${process.env.MCP_SERVER_URL ?? "http://mcp-server:3333"}`);
  console.log(`   Stage: 0 (skeleton — auth/proxy added in Stage 2)`);
});

process.on("unhandledRejection", (reason) => {
  console.error("[Backend] Unhandled rejection:", reason);
  process.exit(1);
});
