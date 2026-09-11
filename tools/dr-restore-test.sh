#!/usr/bin/env bash
#
# Disaster-recovery rehearsal: prove that the newest instance backup actually
# restores, without touching anything that is live.
#
#   sudo ./tools/dr-restore-test.sh                       # newest local dump
#   ./tools/dr-restore-test.sh --dump path/to/dump.sql.gz # a dump you fetched
#   ./tools/dr-restore-test.sh --dump … --boot            # also boot a panel against it
#
# What it does:
#   1. finds the newest instance dump (or takes the one you pass);
#   2. starts a THROWAWAY Postgres container on a free high port;
#   3. restores the dump into it with `psql -v ON_ERROR_STOP=1` — the exact
#      command docs/instance-backup.md tells operators to run;
#   4. asserts the core tables exist and prints their row counts;
#   5. with --boot, starts the panel image against the restored database and
#      waits for `GET /api/ready` to answer 200;
#   6. removes the container (and the booted panel) in a trap, always.
#
# Nothing is written to the live database, the config directory or the Swarm.
#
# Flags:
#   --dump <file>     gzipped SQL dump to restore (default: newest found)
#   --dir <dir>       where to look for dumps (default: <config>/backups)
#   --port <port>     host port for the scratch Postgres (default: a free one)
#   --image <ref>     Postgres image        (default: postgres:17-alpine)
#   --boot            also boot the panel image against the restored database
#   --panel-image <ref>  panel image for --boot (default: the running service's)
#   --keep            leave the scratch container running for inspection
#
# Environment:
#   NIXPLOY_CONFIG_DIR   config directory (default: /etc/nixploy)
#
set -euo pipefail

CONFIG_DIR="${NIXPLOY_CONFIG_DIR:-/etc/nixploy}"
DUMP=""
SEARCH_DIR=""
PG_PORT=""
PG_IMAGE="postgres:17-alpine"
PANEL_IMAGE=""
BOOT=0
KEEP=0

while [ $# -gt 0 ]; do
	case "$1" in
		--dump) DUMP="${2:-}"; shift 2 ;;
		--dir) SEARCH_DIR="${2:-}"; shift 2 ;;
		--port) PG_PORT="${2:-}"; shift 2 ;;
		--image) PG_IMAGE="${2:-}"; shift 2 ;;
		--panel-image) PANEL_IMAGE="${2:-}"; shift 2 ;;
		--boot) BOOT=1; shift ;;
		--keep) KEEP=1; shift ;;
		-h|--help) sed -n '2,33p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) printf 'Unknown flag: %s (try --help)\n' "$1" >&2; exit 2 ;;
	esac
done

if [ -t 1 ] && [ "${NO_COLOR:-}" = "" ]; then
	C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
	C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'
else
	C_RESET=""; C_BOLD=""; C_DIM=""; C_GREEN=""; C_YELLOW=""; C_RED=""
fi
ok()   { printf '   %s✓%s %s\n' "${C_GREEN}" "${C_RESET}" "$*"; }
info() { printf '   %s·%s %s\n' "${C_DIM}" "${C_RESET}" "$*"; }
warn() { printf '   %s!%s %s\n' "${C_YELLOW}" "${C_RESET}" "$*" >&2; }
die()  { printf '\n   %s✗ %s%s\n\n' "${C_RED}${C_BOLD}" "$*" "${C_RESET}" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker is required"
docker info >/dev/null 2>&1 || die "the Docker daemon is not reachable"

SCRATCH="nixploy-dr-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
PANEL_CONTAINER="${SCRATCH}-panel"

cleanup() {
	[ "${KEEP}" = "1" ] && { warn "Leaving ${SCRATCH} running (--keep). Remove it with: docker rm -f ${SCRATCH}"; return; }
	docker rm -f "${PANEL_CONTAINER}" >/dev/null 2>&1 || true
	docker rm -f "${SCRATCH}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ── 1. locate the dump ───────────────────────────────────────────────────────
find_dump() {
	local dir="${SEARCH_DIR:-${CONFIG_DIR}/backups}"
	[ -d "${dir}" ] || die "No dump given and ${dir} does not exist — pass --dump <file.sql.gz>"
	# Newest *.sql.gz / *.gz below the backups tree: update.sh's pre-update
	# dumps and the local-destination instance backups both live there.
	local found
	found="$(find "${dir}" -type f \( -name '*.sql.gz' -o -name '*.gz' \) -print0 2>/dev/null \
		| xargs -0 ls -1t 2>/dev/null | head -n 1 || true)"
	[ -n "${found}" ] || die "No .gz dump found under ${dir} — pass --dump <file.sql.gz>"
	printf '%s' "${found}"
}

[ -n "${DUMP}" ] || DUMP="$(find_dump)"
[ -f "${DUMP}" ] || die "Dump not found: ${DUMP}"
gzip -t "${DUMP}" 2>/dev/null || die "Not a valid gzip file: ${DUMP}"

printf '\n  %sNixploy DR restore test%s\n\n' "${C_BOLD}" "${C_RESET}"
info "dump:  ${DUMP} ($(($(wc -c < "${DUMP}") / 1024)) KiB gzipped)"

# ── 2. scratch Postgres ──────────────────────────────────────────────────────
# A free ephemeral port so a rehearsal never collides with the real Postgres
# (or with a second rehearsal running next to it).
free_port() {
	local port
	for _ in $(seq 1 50); do
		port=$(( 20000 + RANDOM % 20000 ))
		(printf '' >"/dev/tcp/127.0.0.1/${port}") >/dev/null 2>&1 || { printf '%s' "${port}"; return 0; }
	done
	die "Could not find a free port"
}
[ -n "${PG_PORT}" ] || PG_PORT="$(free_port)"

info "scratch postgres: ${SCRATCH} on 127.0.0.1:${PG_PORT} (${PG_IMAGE})"
docker run -d --name "${SCRATCH}" \
	-e POSTGRES_USER=nixploy \
	-e POSTGRES_PASSWORD=nixploy \
	-e POSTGRES_DB=nixploy \
	-p "127.0.0.1:${PG_PORT}:5432" \
	"${PG_IMAGE}" >/dev/null || die "Could not start the scratch Postgres"

waited=0
while [ "${waited}" -lt 60 ]; do
	docker exec "${SCRATCH}" pg_isready -q -U nixploy -d nixploy >/dev/null 2>&1 && break
	sleep 1
	waited=$((waited + 1))
done
docker exec "${SCRATCH}" pg_isready -q -U nixploy -d nixploy >/dev/null 2>&1 \
	|| die "Scratch Postgres never became ready"
ok "Scratch Postgres ready"

# ── 3. restore ───────────────────────────────────────────────────────────────
# The exact command docs/instance-backup.md gives operators. ON_ERROR_STOP=1
# means a dump taken without `--clean --if-exists` fails loudly here rather
# than half-applying during a real outage.
restore_once() {
	local label="$1" log
	log="$(mktemp)"
	if gunzip -c "${DUMP}" | docker exec -i "${SCRATCH}" \
		psql -q -U nixploy -d nixploy -v ON_ERROR_STOP=1 >"${log}" 2>&1; then
		ok "${label}"
		rm -f "${log}"
		return 0
	fi
	printf '\n'
	tail -n 25 "${log}" >&2
	rm -f "${log}"
	die "Restore FAILED (${label}) — the dump does not restore cleanly"
}

restore_once "Restored into an empty database (psql -v ON_ERROR_STOP=1)"
# The second pass is the one that matters: a real restore lands on a database
# whose tables already exist (install.sh boots the panel, which migrates before
# you get to restore). Without `--clean --if-exists` in the dump this fails
# with "relation already exists" — ops audit #12.
restore_once "Restored a second time over the populated database (--clean --if-exists works)"

# ── 4. assert the schema is there ────────────────────────────────────────────
psql_scalar() {
	docker exec "${SCRATCH}" psql -tAq -U nixploy -d nixploy -c "$1" 2>/dev/null | tr -d '[:space:]'
}

tables="$(psql_scalar "select count(*) from information_schema.tables where table_schema='public'")"
[ "${tables:-0}" -gt 0 ] || die "The restored database has no tables in the public schema"
ok "${tables} tables in the public schema"

# Tables every Nixploy schema has ever had: their absence means this is not an
# instance dump at all. Newer tables (backup_run, domain_middleware, …) are
# reported when present but never required — a dump from an older release must
# still pass this rehearsal.
REQUIRED_TABLES='organization user project environment application deployment'
OPTIONAL_TABLES='notification backup_run domain server compose'

printf '\n   %sRow counts%s\n' "${C_BOLD}" "${C_RESET}"
missing=""
for table in ${REQUIRED_TABLES} ${OPTIONAL_TABLES}; do
	exists="$(psql_scalar "select to_regclass('public.\"${table}\"') is not null")"
	if [ "${exists}" != "t" ]; then
		case " ${REQUIRED_TABLES} " in *" ${table} "*) missing="${missing} ${table}" ;; esac
		printf '   %-18s %s\n' "${table}" "(absent)"
		continue
	fi
	count="$(psql_scalar "select count(*) from \"${table}\"")"
	printf '   %-18s %s\n' "${table}" "${count:-?}"
done
[ -z "${missing}" ] || die "Missing core table(s):${missing} — this dump is not a Nixploy instance dump"

users="$(psql_scalar 'select count(*) from "user"')"
[ "${users:-0}" -gt 0 ] || warn "The restored database has no users — is this dump from before /setup?"

# ── 5. optional: boot the panel against the restored database ────────────────
boot_panel() {
	[ "${BOOT}" = "1" ] || return 0
	if [ -z "${PANEL_IMAGE}" ]; then
		PANEL_IMAGE="$(docker service inspect nixploy --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' 2>/dev/null || true)"
		PANEL_IMAGE="${PANEL_IMAGE%%@*}"
	fi
	[ -n "${PANEL_IMAGE}" ] || { warn "No panel image found — pass --panel-image <ref> to boot one"; return 0; }
	local port
	port="$(free_port)"
	printf '\n   %sBooting %s against the restored database%s\n' "${C_BOLD}" "${PANEL_IMAGE}" "${C_RESET}"
	# Throwaway secrets: this panel never serves traffic and is destroyed
	# below, so it must NOT get the real ENCRYPTION_KEY. Encrypted columns
	# stay unreadable — that is expected and not what this step checks.
	docker run -d --name "${PANEL_CONTAINER}" \
		--network host \
		-e "DATABASE_URL=postgres://nixploy:nixploy@127.0.0.1:${PG_PORT}/nixploy" \
		-e "PORT=${port}" \
		-e "BETTER_AUTH_URL=http://127.0.0.1:${port}" \
		-e "BETTER_AUTH_SECRET=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')" \
		-e "ENCRYPTION_KEY=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')" \
		-e NIXPLOY_DISABLE_TRAEFIK_BOOT=1 \
		-e NIXPLOY_CONFIG_DIR=/tmp/nixploy-dr \
		"${PANEL_IMAGE}" >/dev/null || { warn "Could not start the panel container"; return 0; }
	local code="" tries=0
	while [ "${tries}" -lt 90 ]; do
		code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${port}/api/ready" 2>/dev/null || true)"
		[ "${code}" = "200" ] && break
		docker inspect -f '{{.State.Running}}' "${PANEL_CONTAINER}" 2>/dev/null | grep -qx true || break
		sleep 2
		tries=$((tries + 1))
	done
	if [ "${code}" = "200" ]; then
		ok "Panel booted and /api/ready answered 200 against the restored database"
	else
		docker logs --tail 30 "${PANEL_CONTAINER}" 2>&1 | sed 's/^/     /' >&2 || true
		die "Panel did not become ready against the restored database (last status: ${code:-none})"
	fi
}
boot_panel

printf '\n  %s╭────────────────────────────────────────────╮%s\n' "${C_GREEN}" "${C_RESET}"
printf '  %s│%s   %sDR restore test passed%s                   %s│%s\n' "${C_GREEN}" "${C_RESET}" "${C_BOLD}" "${C_RESET}" "${C_GREEN}" "${C_RESET}"
printf '  %s╰────────────────────────────────────────────╯%s\n\n' "${C_GREEN}" "${C_RESET}"
info "Restoring for real: docs/instance-backup.md → Restoring (manual)"
printf '\n'
