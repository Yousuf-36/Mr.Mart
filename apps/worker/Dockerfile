FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
COPY apps/worker/package.json ./apps/worker/
RUN npm install --workspace=apps/worker

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/worker/ ./apps/worker/
RUN npm run build --workspace=apps/worker

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY apps/worker/package.json ./apps/worker/

CMD ["node", "apps/worker/dist/index.js"]
