FROM node:24.19.0-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@12.4.2
WORKDIR /workspace

FROM base AS build
COPY . .
RUN pnpm --filter @smartsite/contracts --filter @smartsite/backend install --frozen-lockfile
RUN pnpm --filter @smartsite/contracts build
RUN pnpm --filter @smartsite/backend build

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY contracts/package.json contracts/package.json
RUN pnpm --filter @smartsite/contracts --filter @smartsite/backend install --prod --frozen-lockfile

FROM node:24.19.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /workspace/apps/backend
COPY --from=dependencies --chown=node:node /workspace/node_modules /workspace/node_modules
COPY --from=dependencies --chown=node:node /workspace/contracts /workspace/contracts
COPY --from=dependencies --chown=node:node /workspace/apps/backend/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/contracts/dist /workspace/contracts/dist
COPY --from=build --chown=node:node /workspace/contracts/schemas /workspace/contracts/schemas
COPY --from=build --chown=node:node /workspace/apps/backend/dist ./dist
COPY --from=build --chown=node:node /workspace/apps/backend/package.json ./package.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
