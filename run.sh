#!/bin/bash
set -e

echo "============================================"
echo "  Bambu Monitor - Starting..."
echo "  Web UI: http://[HA-IP]:3001"
echo "============================================"

export PORT=3001
export NODE_ENV=production

echo "Node.js version: $(node --version)"
echo "Starting Express + WebSocket server on port ${PORT}..."

cd /app/backend
exec node server.js
