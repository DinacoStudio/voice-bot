# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ pkg-config libopus-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libopus0 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/data \
    && chown -R node:node /app

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json config.json README.md ./
COPY --chown=node:node src ./src

USER node
CMD ["node", "src/index.js"]
