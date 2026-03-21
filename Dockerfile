# ── Stage 1: build the React client ──────────────────────────────────────────
FROM node:20-alpine AS client-builder

# git for version, librsvg for SVG→PNG conversion
RUN apk add --no-cache git librsvg

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

# Convert SVG icon to PNG for Cloudron
COPY icon.svg ./
RUN apk add --no-cache librsvg && \
    rsvg-convert -w 512 -h 512 icon.svg -o icon.png && \
    apk del librsvg

EXPOSE 3000
CMD ["./start.sh"]
