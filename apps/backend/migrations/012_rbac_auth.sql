-- Migration 012: RBAC and Auth tables
-- Creates users, store_users, and api_tokens tables for Multi-Tenant Auth & Role Isolation.
-- Roles: 'owner' | 'manager' | 'staff'.

BEGIN;

-- 1. Users table
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  phone       TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Store Users (RBAC role mapping)
CREATE TABLE IF NOT EXISTS store_users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, store_id)
);

CREATE INDEX IF NOT EXISTS store_users_store_user_idx ON store_users (store_id, user_id);

-- 3. API Tokens
CREATE TABLE IF NOT EXISTS api_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  token       TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS api_tokens_token_idx ON api_tokens (token);

COMMIT;
