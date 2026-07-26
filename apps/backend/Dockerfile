FROM node:20-alpine AS base
WORKDIR /app

# ── Install deps ─────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json* ./
COPY apps/backend/package.json ./apps/backend/
RUN npm install --workspace=apps/backend

# Also copy migration runner (needs pg, which is in backend deps)
COPY apps/backend/migrations/ ./apps/backend/migrations/

# ── Build ─────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/backend/ ./apps/backend/
RUN npm run build --workspace=apps/backend

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY apps/backend/package.json ./apps/backend/
COPY apps/backend/migrations/ ./apps/backend/migrations/

EXPOSE 3001
CMD ["node", "apps/backend/dist/index.js"]
