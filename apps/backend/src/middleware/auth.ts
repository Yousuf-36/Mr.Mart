/**
 * Authentication and store isolation middleware for Mr. Mart Backend API (Stage 5).
 * Validates Bearer tokens and API keys against api_tokens table in Postgres.
 * Attaches req.user = { user_id, store_id, role, email, name } to Express Request.
 */

import { Request, Response, NextFunction } from "express";
import { validateApiTokenDb, DbUserContext } from "@mrmart/mcp-server/store/pg-store.js";

declare global {
  namespace Express {
    interface Request {
      user?: DbUserContext;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    let token: string | undefined;

    // 1. Authorization header: "Bearer <token>"
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7).trim();
    }

    // 2. x-api-key header
    if (!token && typeof req.headers["x-api-key"] === "string") {
      token = req.headers["x-api-key"];
    }

    // 3. Query string param (fallback for dev testing)
    if (!token && typeof req.query.token === "string") {
      token = req.query.token;
    }

    if (!token) {
      res.status(401).json({ error: "Unauthorized: Missing API token or Bearer authorization header" });
      return;
    }

    const userContext = await validateApiTokenDb(token);
    if (!userContext) {
      res.status(401).json({ error: "Unauthorized: Invalid or expired API token" });
      return;
    }

    req.user = userContext;
    next();
  } catch (err) {
    next(err);
  }
}
