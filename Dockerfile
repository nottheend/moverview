# ── Stage 1: build the React client ──────────────────────────────────────────
FROM node:20-alpine AS client-builder

# git needed for version detection at build time
RUN apk add --no-cache git

WORKDIR /build/client
COPY client/package*.json ./
RUN npm ci

COPY .git /build/.git
COPY client/ ./
RUN npm run build

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

COPY server/ ./server/
COPY --from=client-builder /build/client/dist ./client/dist

COPY start.sh ./
RUN chmod +x start.sh

# icon.svg is used by CloudronManifest.json — no conversion needed, Cloudron accepts SVG
COPY icon.svg ./

EXPOSE 3000
CMD ["./start.sh"]
