#!/bin/sh
# Runs pending node-pg-migrate migrations against POSTGRES_* env vars, then
# hands off to the container's real CMD. Without this, migrations/*.js never
# run in production — the image only ever started the server.
set -e

echo "🚀 Running database migrations..."
node src/migrate.js --action=up

exec "$@"
