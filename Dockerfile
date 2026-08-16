# syntax=docker/dockerfile:1

# ── QORVEXA CRM · production image ───────────────────────────────────────────
# Two stages: a builder that installs everything and compiles the client, and a
# slim runtime that ships the generated Prisma client + built dist/ + server.
# The runtime runs as the non-root `node` user and health-checks /api/health.

# ── Stage 1 · builder ─────────────────────────────────────────────────────────
FROM node:24-slim AS builder
WORKDIR /app

# Install dependencies first (maximizes layer caching when source changes).
COPY package.json package-lock.json ./
RUN npm ci

# Prisma client must be generated for the runtime platform before building.
COPY prisma ./prisma
RUN npx prisma generate

# Copy the rest of the source and build the client (typecheck + vite → dist/).
COPY . .
RUN npm run build

# ── Stage 2 · runtime ─────────────────────────────────────────────────────────
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Node's official images ship a `node` user; run the server as it (non-root).
# The server writes scheduled snapshot archives to backups/ and GDPR/portability
# exports to portability/ at runtime — give the app user a writable home.
RUN mkdir -p /app/backups /app/portability && chown -R node:node /app

# Prisma needs its generated client + the CLI at runtime (for `db push`/backfill
# tasks) — carry the full dependency tree over from the builder.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/server ./server
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/package.json /app/package-lock.json ./

USER node
EXPOSE 8787

# Wait-for-Mongo is handled by docker-compose depends_on + mongo-init; the app
# itself boots even when the DB is down (health reports degraded), so a plain
# start is the right entrypoint. Prisma uses engines matching this image.
CMD ["npm", "start"]

# Healthcheck: node:24-slim has no curl/wget, so probe with the built-in fetch.
# /api/health reports ok only when Mongo answers a ping.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>r.ok?r.json():Promise.reject(r.status)).then(j=>process.exit(j.status==='ok'?0:1)).catch(()=>process.exit(1))"
