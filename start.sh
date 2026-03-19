#!/bin/sh
set -e

export NODE_ENV=production

# Auto-generate SESSION_SECRET on first run if not set.
if [ -z "$SESSION_SECRET" ]; then
  SECRET_FILE=/app/data/session.secret
  if [ ! -f "$SECRET_FILE" ]; then
    dd if=/dev/urandom bs=256 count=1 2>/dev/null | base64 > "$SECRET_FILE"
  fi
  export SESSION_SECRET=$(cat "$SECRET_FILE")
fi

cd /app/server
exec node index.js
