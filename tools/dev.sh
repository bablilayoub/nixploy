#!/usr/bin/env bash
#
# Nixploy local development stack — one command from a fresh clone.
#
#   ./tools/dev.sh
#
# It:
#   1. checks Node ≥ 22 (see .nvmrc), pnpm and Docker;
#   2. starts (or creates) the throwaway Postgres container `nixploy-dev-pg`
#      on 127.0.0.1:54329;
#   3. creates apps/web/.env from .env.example with real random secrets when
#      it does not exist yet;
#   4. applies the Drizzle migrations;
#   5. runs the panel on :3000 and the landing site on :3001 until Ctrl+C.
#
# Flags:
#   --skip-install    do not run `pnpm install` even when node_modules is thin
#   --skip-migrate    do not run `pnpm db:migrate`
#   --no-landing      panel only
#   --no-postgres     assume DATABASE_URL already points at a running server
#
# Environment:
#   PORT                    panel port                      (default: 3000)
#   LANDING_PORT            landing port                    (default: 3001)
#   NIXPLOY_DEV_PG_PORT     host port of the dev Postgres   (default: 54329)
#   NIXPLOY_DEV_PG_CONTAINER  container name                (default: nixploy-dev-pg)
#
# macOS notes and the Traefik-free UI mode: docs/development.md.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

WEB_PORT="${PORT:-3000}"
LANDING_PORT="${LANDING_PORT:-3001}"
PG_CONTAINER="${NIXPLOY_DEV_PG_CONTAINER:-nixploy-dev-pg}"
PG_PORT="${NIXPLOY_DEV_PG_PORT:-54329}"
PG_IMAGE="${NIXPLOY_DEV_PG_IMAGE:-postgres:17-alpine}"
PG_USER=nixploy
PG_PASSWORD=nixploy
PG_DB=nixploy

SKIP_INSTALL=0
SKIP_MIGRATE=0
NO_LANDING=0
NO_POSTGRES=0
for arg in "$@"; do
	case "${arg}" in
		--skip-install) SKIP_INSTALL=1 ;;
		--skip-migrate) SKIP_MIGRATE=1 ;;
		--no-landing) NO_LANDING=1 ;;
		--no-postgres) NO_POSTGRES=1 ;;
		-h|--help) sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) printf 'Unknown flag: %s (try --help)\n' "${arg}" >&2; exit 2 ;;
	esac
done

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing dependency: $1"; }

bold "Nixploy dev"
info "repo: ${ROOT}"

need node
need pnpm
[ "${NO_POSTGRES}" = "1" ] || need docker

if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
	die "Node >= 22 required (found $(node -v)) — see .nvmrc"
fi

# ── apps/web/.env ────────────────────────────────────────────────────────────
ENV_FILE="${ROOT}/apps/web/.env"
if [ ! -f "${ENV_FILE}" ]; then
	[ -f "${ROOT}/apps/web/.env.example" ] || die "missing apps/web/.env.example"
	bold "Creating apps/web/.env"
	cp "${ROOT}/apps/web/.env.example" "${ENV_FILE}"
	# Real secrets: a placeholder ENCRYPTION_KEY makes every stored credential
	# undecryptable the moment it is replaced, so generate them once, here.
	secret="$(openssl rand -hex 24)"
	encryption="$(openssl rand -hex 16)"
	tmp="$(mktemp)"
	sed -e "s/^BETTER_AUTH_SECRET=.*/BETTER_AUTH_SECRET=${secret}/" \
		-e "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=${encryption}/" \
		-e "s#^BETTER_AUTH_URL=.*#BETTER_AUTH_URL=http://localhost:${WEB_PORT}#" \
		"${ENV_FILE}" > "${tmp}"
	mv "${tmp}" "${ENV_FILE}"
	chmod 600 "${ENV_FILE}"
	printf 'NIXPLOY_CONFIG_DIR=%s/.nixploy-data\n' "${ROOT}" >> "${ENV_FILE}"
	info "wrote ${ENV_FILE}"
fi

set -a
# shellcheck disable=SC1090
. "${ENV_FILE}"
set +a
export DATABASE_URL="${DATABASE_URL:-postgres://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/${PG_DB}}"
export BETTER_AUTH_URL="${BETTER_AUTH_URL:-http://localhost:${WEB_PORT}}"
export NIXPLOY_CONFIG_DIR="${NIXPLOY_CONFIG_DIR:-${ROOT}/.nixploy-data}"
mkdir -p "${NIXPLOY_CONFIG_DIR}"

# ── Postgres ─────────────────────────────────────────────────────────────────
start_postgres() {
	[ "${NO_POSTGRES}" = "1" ] && { info "postgres: not managed (--no-postgres)"; return 0; }
	case "${DATABASE_URL}" in
		*":${PG_PORT}/"*) ;;
		*) info "postgres: DATABASE_URL points elsewhere — not managing ${PG_CONTAINER}"; return 0 ;;
	esac
	if docker ps --format '{{.Names}}' | grep -qx "${PG_CONTAINER}"; then
		info "postgres: ${PG_CONTAINER} already running"
	elif docker ps -a --format '{{.Names}}' | grep -qx "${PG_CONTAINER}"; then
		bold "Starting ${PG_CONTAINER}"
		docker start "${PG_CONTAINER}" >/dev/null
	else
		bold "Creating ${PG_CONTAINER} on 127.0.0.1:${PG_PORT}"
		docker run -d --name "${PG_CONTAINER}" \
			-e POSTGRES_USER="${PG_USER}" \
			-e POSTGRES_PASSWORD="${PG_PASSWORD}" \
			-e POSTGRES_DB="${PG_DB}" \
			-p "127.0.0.1:${PG_PORT}:5432" \
			"${PG_IMAGE}" >/dev/null \
			|| die "could not start Postgres on :${PG_PORT} (is the port taken?)"
	fi
	local waited=0
	while [ "${waited}" -lt 60 ]; do
		docker exec "${PG_CONTAINER}" pg_isready -q -U "${PG_USER}" -d "${PG_DB}" >/dev/null 2>&1 && break
		sleep 0.5
		waited=$((waited + 1))
	done
	docker exec "${PG_CONTAINER}" pg_isready -q -U "${PG_USER}" -d "${PG_DB}" >/dev/null 2>&1 \
		|| die "${PG_CONTAINER} did not become ready"
	info "postgres: 127.0.0.1:${PG_PORT}"
}

start_postgres

# ── install + migrate ────────────────────────────────────────────────────────
if [ "${SKIP_INSTALL}" = "0" ] && { [ ! -d "${ROOT}/node_modules" ] || [ ! -d "${ROOT}/apps/web/node_modules" ]; }; then
	bold "pnpm install"
	CI=true pnpm install
fi

if [ "${SKIP_MIGRATE}" = "0" ]; then
	bold "Applying migrations"
	pnpm db:migrate
fi

# ── dev servers ──────────────────────────────────────────────────────────────
# Job control puts each child in its own process group so Ctrl+C reaches
# pnpm → node → Next instead of only this wrapper.
set -m
PIDS=()

cleanup() {
	trap - EXIT INT TERM
	printf '\n'
	bold "Stopping"
	local pid
	for pid in ${PIDS[@]+"${PIDS[@]}"}; do
		kill -TERM "-${pid}" 2>/dev/null || kill -TERM "${pid}" 2>/dev/null || true
	done
	wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

bold "Starting apps"
( cd "${ROOT}/apps/web" && exec pnpm dev ) &
PIDS+=($!)
if [ "${NO_LANDING}" = "0" ]; then
	( cd "${ROOT}/apps/landing" && exec pnpm dev ) &
	PIDS+=($!)
fi

printf '\n'
bold "Ready"
info "Panel:    http://localhost:${WEB_PORT}   (first run: /setup)"
[ "${NO_LANDING}" = "0" ] && info "Landing:  http://localhost:${LANDING_PORT}"
info "Swagger:  http://localhost:${WEB_PORT}/swagger"
info "Config:   ${NIXPLOY_CONFIG_DIR}"
info "Ctrl+C to stop"
printf '\n'

# Exit as soon as any dev server dies so a crashed panel is not hidden behind
# a still-running landing site.
while true; do
	for pid in "${PIDS[@]}"; do
		kill -0 "${pid}" 2>/dev/null && continue
		wait "${pid}" 2>/dev/null || true
		exit 1
	done
	sleep 1
done
