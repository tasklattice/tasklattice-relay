FROM alpine:3.22 AS openshell-cli
ARG TARGETARCH
ARG OPENSHELL_VERSION=0.0.106
RUN apk add --no-cache ca-certificates curl tar \
    && case "${TARGETARCH}" in \
      amd64) asset="openshell-x86_64-unknown-linux-musl.tar.gz" ;; \
      arm64) asset="openshell-aarch64-unknown-linux-musl.tar.gz" ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && curl --fail --location --retry 5 \
      --output /tmp/openshell.tar.gz \
      "https://github.com/NVIDIA/OpenShell/releases/download/v${OPENSHELL_VERSION}/${asset}" \
    && tar -xzf /tmp/openshell.tar.gz -C /usr/local/bin openshell \
    && chmod 0755 /usr/local/bin/openshell

FROM alpine:3.22 AS helm-cli
ARG TARGETARCH
ARG HELM_VERSION=3.19.0
RUN apk add --no-cache ca-certificates curl tar \
    && curl --fail --location --retry 5 \
      --output /tmp/helm.tar.gz \
      "https://get.helm.sh/helm-v${HELM_VERSION}-linux-${TARGETARCH}.tar.gz" \
    && tar -xzf /tmp/helm.tar.gz -C /tmp \
    && install -m 0755 "/tmp/linux-${TARGETARCH}/helm" /usr/local/bin/helm

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential python3 \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/control/package.json apps/control/package.json
COPY apps/example-mcp-server/package.json apps/example-mcp-server/package.json
COPY apps/expert-agent-runtime/package.json apps/expert-agent-runtime/package.json
COPY apps/runner/package.json apps/runner/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN --mount=type=cache,target=/root/.npm \
    npm_config_fetch_retries=5 \
    npm_config_fetch_retry_maxtimeout=120000 \
    npm ci --include=optional

FROM dependencies AS build
COPY tsconfig.base.json ./
COPY apps ./apps
COPY artifacts ./artifacts
COPY docs ./docs
COPY packages ./packages
COPY scripts/validate-prisma-migrations.mjs ./scripts/validate-prisma-migrations.mjs
RUN npm run build --workspace @tali/contracts \
    && npm run build --workspace @tali/expert-agent-runtime \
    && npm run build --workspace @tali/control \
    && npm run build --workspace @tali/runner \
    && npm run build --workspace @tali/example-mcp-server

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS control
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    TALI_HELM_CHART=/opt/tali/helm/tali-relay.tgz \
    HELM_CACHE_HOME=/tmp/helm/cache \
    HELM_CONFIG_HOME=/tmp/helm/config \
    HELM_DATA_HOME=/tmp/helm/data
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl poppler-utils \
    && rm -rf /var/lib/apt/lists/*
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=helm-cli /usr/local/bin/helm /usr/local/bin/helm
COPY package.json package-lock.json ./
COPY apps/control/package.json apps/control/package.json
COPY --from=build /app/apps/control/prisma ./apps/control/prisma
COPY --from=build /app/apps/control/prisma.config.ts ./apps/control/prisma.config.ts
COPY --from=build /app/apps/control/server/config ./apps/control/server/config
COPY --from=build /app/apps/control/.output ./apps/control/.output
COPY --from=build /app/artifacts/skills/vendor ./artifacts/skills/vendor
COPY dist/control-plane-chart/tali-relay.tgz /opt/tali/helm/tali-relay.tgz
COPY charts/tali-relay/charts/openshell-*.tgz /opt/tali/helm/openshell.tgz
USER 10001
EXPOSE 8080
CMD ["node", "apps/control/.output/server/index.mjs"]

FROM node:22-bookworm-slim AS demo-test
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/example-mcp-server/package.json apps/example-mcp-server/package.json
COPY apps/expert-agent-runtime/package.json apps/expert-agent-runtime/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY --from=build /app/apps/example-mcp-server/dist ./apps/example-mcp-server/dist
COPY --from=build /app/apps/expert-agent-runtime/dist ./apps/expert-agent-runtime/dist
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
USER node
EXPOSE 3000
ENTRYPOINT ["node", "apps/example-mcp-server/dist/index.js"]
CMD ["mcp"]

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=9090 \
    NEMOCLAW_RUNNER_MODE=openshell-kubernetes
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssh-client tar \
    && rm -rf /var/lib/apt/lists/*
COPY --from=openshell-cli /usr/local/bin/openshell /usr/local/bin/openshell
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/apps/runner/dist ./apps/runner/dist
COPY apps/runner/package.json ./apps/runner/package.json
USER node
EXPOSE 9090
CMD ["node", "apps/runner/dist/index.js"]

FROM node:22-bookworm-slim AS expert-agent-runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY apps/expert-agent-runtime/package.json ./apps/expert-agent-runtime/package.json
COPY --from=build /app/apps/expert-agent-runtime/dist ./apps/expert-agent-runtime/dist
USER node
EXPOSE 8080
CMD ["node", "apps/expert-agent-runtime/dist/server.js"]
