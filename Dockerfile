# ── Stage 1: build the React client ──────────────────────────────────────────
FROM node:20-alpine AS client-builder

WORKDIR /build/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Server dependencies
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Server source
COPY server/ ./server/

# Built frontend (served as static files by Express)
COPY --from=client-builder /build/client/dist ./client/dist

COPY start.sh ./
RUN chmod +x start.sh

EXPOSE 3000
CMD ["./start.sh"]
