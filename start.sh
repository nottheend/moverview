#!/bin/sh
set -e

export NODE_ENV=production

cd /app/server
exec node index.js
