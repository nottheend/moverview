# ── Stage 1: build the React client ──────────────────────────────────────────
FROM node:22-alpine AS client-builder

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

RUN npm install -g npm@latest

WORKDIR /build/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

COPY server/ ./server/
COPY --from=client-builder /build/client/dist ./client/dist

COPY start.sh ./
RUN chmod +x start.sh

# icon.svg — single source for Cloudron tile, browser favicon, and nav logo
COPY icon.svg ./
COPY icon.svg ./client/dist/icon.svg

EXPOSE 3000
CMD ["./start.sh"]
