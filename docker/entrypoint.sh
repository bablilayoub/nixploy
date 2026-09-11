#!/bin/sh
set -eu

echo "▲ Nixploy entrypoint"

if [ -z "${DATABASE_URL:-}" ]; then
	echo "DATABASE_URL is required" >&2
	exit 1
fi

# After a host reboot Swarm starts nixploy and nixploy-postgres together;
# exiting 1 straight away turns that into a restart loop. Give Postgres up to
# NIXPLOY_DB_WAIT_SECONDS (default 60) before migrating. pg_isready reads the
# DSN itself, so the password never appears on argv of another process.
wait_for_postgres() {
	max="${NIXPLOY_DB_WAIT_SECONDS:-60}"
	waited=0
	while ! pg_isready -q -d "${DATABASE_URL}" 2>/dev/null; do
		if [ "${waited}" -ge "${max}" ]; then
			echo "▲ Postgres not ready after ${max}s — continuing, migrations will retry" >&2
			return 0
		fi
		if [ "${waited}" -eq 0 ]; then
			echo "▲ Waiting for Postgres…"
		fi
		sleep 2
		waited=$((waited + 2))
	done
	[ "${waited}" -eq 0 ] || echo "▲ Postgres ready after ${waited}s"
}

if command -v pg_isready >/dev/null 2>&1; then
	wait_for_postgres
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
