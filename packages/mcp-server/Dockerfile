FROM node:20-alpine AS base
WORKDIR /app

# ── Install deps ─────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json* ./
COPY packages/mcp-server/package.json ./packages/mcp-server/
# Install only production deps for this package
RUN npm install --workspace=packages/mcp-server

# ── Build ─────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/mcp-server/ ./packages/mcp-server/
RUN npm run build --workspace=packages/mcp-server

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/packages/mcp-server/dist ./packages/mcp-server/dist
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/mcp-server/node_modules ./packages/mcp-server/node_modules
COPY packages/mcp-server/package.json ./packages/mcp-server/

EXPOSE 3333
CMD ["node", "packages/mcp-server/dist/index.js"]
