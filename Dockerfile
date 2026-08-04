# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ pkg-config libopus-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM debian:bookworm-slim AS yuriy-voice
ARG RHVOICE_YURIY_REVISION=f074e33c1bff865affd5cec5d6bc46ff4b073511

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && mkdir -p /voice \
    && curl -fsSL "https://github.com/RHVoice/yuriy-rus/archive/${RHVOICE_YURIY_REVISION}.tar.gz" \
       | tar -xz --strip-components=1 -C /voice \
    && test -f /voice/voice.info \
    && test -d /voice/24000

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
    && echo "deb http://deb.debian.org/debian bookworm-backports main non-free" > /etc/apt/sources.list.d/backports.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libopus0 \
    && apt-get install -y --no-install-recommends -t bookworm-backports rhvoice rhvoice-russian \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/data \
    && chown -R node:node /app

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=yuriy-voice /voice /usr/share/RHVoice/voices/yuriy
COPY --chown=node:node package.json package-lock.json config.json README.md ./
COPY --chown=node:node src ./src

USER node
CMD ["node", "src/index.js"]
