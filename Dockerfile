# FlowForge Open — multi-stage image (§4.3)
# Build stage compiles TypeScript + Vite; runtime stage runs as non-root and
# carries only the compiled output plus production node_modules (argon2's
# native module is built during `npm ci` in the build stage and copied across).

# Base image (§4.3/§14.2): node:22-bookworm-slim pinned by digest.
# Digest verified via: docker image ls --digests node:22-bookworm-slim
FROM node:22-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9 AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/cli/package.json apps/cli/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/

RUN npm ci --ignore-scripts=false

COPY tsconfig.json tsconfig.base.json ./
COPY scripts/ scripts/
COPY packages/shared/ packages/shared/
COPY packages/engine/ packages/engine/
COPY apps/server/ apps/server/
COPY apps/cli/ apps/cli/
COPY apps/web/ apps/web/
COPY apps/worker/ apps/worker/

RUN npm run build

# Runtime stage — no build tools, only compiled output + prod deps
FROM node:22-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9

RUN groupadd --gid 10001 flowforge && useradd --uid 10001 --gid flowforge --no-create-home --shell /bin/false flowforge

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps ./apps
COPY --from=build /app/tsconfig.json ./tsconfig.json

RUN chown -R flowforge:flowforge /app

USER flowforge

EXPOSE 8080

ENV NODE_ENV=production
# FF_SEED_DEMO is NOT set here — spec §4.4 lists it as optional ("No"). The
# server defaults it to '0' in env-bootstrap.ts. The SOD launch proof and
# packaging.json runtime_test.env set FF_SEED_DEMO explicitly when demo data
# is needed (spec §14.3 step 6: "If FF_SEED_DEMO=1").
#
# FF_APP_URL is NOT set here — the server derives it from the actual listening
# port or APP_BASE_URL (SOD-provided public origin) at startup so demo workflow
# HTTP steps always target the correct server. Secret keys (FF_VAULT_KEY,
# FF_SESSION_SECRET, FF_OIDC_SIGNING_KEY) are generated at first start and
# persisted under SOD_DATA_DIR by env-bootstrap.ts when not explicitly set by
# the operator (spec §4.4 required; SOD runtime note: generate+persist).

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.FF_PORT||process.env.PORT||8080)+'/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Initialization (§14.3): the single-process entrypoint runs migrations +
# plans (5 rows) + system jobs (7) on EVERY start; demo workspace/data is
# gated internally on FF_SEED_DEMO (spec §14.3 step 6: "If FF_SEED_DEMO=1").
# FF_SEED_DEMO defaults to '0' — the launch proof sets it explicitly.
CMD ["node", "apps/server/dist/index.js"]
