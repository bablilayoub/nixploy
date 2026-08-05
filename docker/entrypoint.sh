#!/bin/sh
set -eu

echo "▲ Nixploy entrypoint"

if [ -z "${DATABASE_URL:-}" ]; then
	echo "DATABASE_URL is required" >&2
	exit 1
fi

MIGRATIONS_DIR="${NIXPLOY_MIGRATIONS_DIR:-/app/drizzle}"
if [ -d "${MIGRATIONS_DIR}" ] && [ -f /app/migrate-deps/migrate.mjs ]; then
	echo "▲ Running database migrations…"
	NIXPLOY_MIGRATIONS_DIR="${MIGRATIONS_DIR}" node /app/migrate-deps/migrate.mjs
else
	echo "▲ No migrate runner / drizzle folder — skipping migrations"
fi

echo "▲ Starting Nixploy"
exec "$@"
