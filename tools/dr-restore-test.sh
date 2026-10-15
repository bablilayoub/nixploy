#!/usr/bin/env bash
#
# Disaster-recovery rehearsal: prove that the newest instance backup actually
# restores, without touching anything that is live.
#
#   sudo ./tools/dr-restore-test.sh                       # newest local dump
#   ./tools/dr-restore-test.sh --dump path/to/dump.sql.gz # a dump you fetched
#   ./tools/dr-restore-test.sh --dump … --boot --panel-image <ref> \
#     --recovery-env <file> --docker-socket <disposable-daemon-socket>
#
# What it does:
#   1. finds the newest instance dump (or takes the one you pass);
#   2. starts a THROWAWAY Postgres container on a private internal network;
#   3. restores the dump into it with `psql -v ON_ERROR_STOP=1` — the exact
#      command docs/instance-backup.md tells operators to run;
#   4. asserts the core tables exist and prints their row counts;
#   5. with --boot, starts the panel image against the restored database and
#      waits for `GET /api/ready` to answer 200 (readiness only, not full DR);
#   6. removes the containers and their anonymous volumes in a trap, always.
#
# Nothing is written to the live database, the config directory or the Swarm.
# --boot uses a private internal network and role=panel (no jobs).
# Readiness is checked inside the panel container; no panel port is published.
#
# Flags:
#   --dump <file>     gzipped SQL dump to restore (default: newest found)
#   --dir <dir>       where to look for dumps (default: <config>/backups)
#   --port <port>     requested scratch Postgres host port (internal-network access varies)
#   --image <ref>     Postgres image        (default: postgres:17-alpine)
#   --boot            require panel readiness against the restored database
#   --panel-image <ref>  panel image for --boot (default: the running service's)
#   --recovery-env <file>  Docker-format recovery keys; see docs/instance-backup.md
#   --docker-socket <path>  explicit DISPOSABLE daemon socket for --boot readiness
#   --keep            leave scratch resources for inspection with docker exec
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
RECOVERY_ENV=""
DOCKER_SOCKET=""
BOOT=0
KEEP=0

while [ $# -gt 0 ]; do
	case "$1" in
		--dump) DUMP="${2:-}"; shift 2 ;;
		--dir) SEARCH_DIR="${2:-}"; shift 2 ;;
		--port) PG_PORT="${2:-}"; shift 2 ;;
		--image) PG_IMAGE="${2:-}"; shift 2 ;;
		--panel-image) PANEL_IMAGE="${2:-}"; shift 2 ;;
		--recovery-env) RECOVERY_ENV="${2:-}"; shift 2 ;;
		--docker-socket) DOCKER_SOCKET="${2:-}"; shift 2 ;;
		--boot) BOOT=1; shift ;;
		--keep) KEEP=1; shift ;;
		-h|--help) sed -n '2,/^set -euo pipefail/{ /^set -euo pipefail/d; s/^# \{0,1\}//; p; }' "$0"; exit 0 ;;
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

if [ "${BOOT}" = "1" ]; then
	[ -n "${RECOVERY_ENV}" ] && [ -f "${RECOVERY_ENV}" ] \
		|| die "--boot requires --recovery-env <file>; keys are not in the instance archive"
	# A dedicated Docker env file, not a sourced shell .env. Docker preserves
	# quotes literally, which would silently change the recovered keys.
	awk '
		/^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
		{
			separator = index($0, "="); key = substr($0, 1, separator - 1)
			value = substr($0, separator + 1)
			if (!separator || key !~ /^(ENCRYPTION_KEYS|ENCRYPTION_KEY|BETTER_AUTH_SECRET)$/ ||
				value ~ /^[[:space:]]*["\047]/ || value ~ /["\047][[:space:]]*$/ ||
				value ~ /\r/ || value ~ /^[[:space:]]*$/ || seen[key]++) invalid = 1
		}
		END { exit invalid || !seen["BETTER_AUTH_SECRET"] || !(seen["ENCRYPTION_KEYS"] || seen["ENCRYPTION_KEY"]) }
	' "${RECOVERY_ENV}" || die "Recovery file must contain only unquoted KEY=value entries: BETTER_AUTH_SECRET and ENCRYPTION_KEYS or ENCRYPTION_KEY (no export or shell syntax)"
	case "${DOCKER_SOCKET}" in
		/*) ;;
		*) die "--boot requires --docker-socket <absolute disposable daemon socket path>" ;;
	esac
	[[ "${DOCKER_SOCKET}" != *","* && "${DOCKER_SOCKET}" != *$'\n'* && "${DOCKER_SOCKET}" != *$'\r'* ]] \
		|| die "Invalid Docker socket path"
	if [ -z "${PANEL_IMAGE}" ]; then
		PANEL_IMAGE="$(docker service inspect nixploy --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' 2>/dev/null || true)"
	fi
	[ -n "${PANEL_IMAGE}" ] || die "--boot could not resolve a panel image; pass --panel-image <ref>"
fi

SCRATCH="nixploy-dr-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
PANEL_CONTAINER="${SCRATCH}-panel"
SCRATCH_NETWORK="${SCRATCH}-network"

cleanup() {
	[ "${KEEP}" = "1" ] && { warn "Leaving scratch resources (--keep). Cleanup: docker rm -fv ${PANEL_CONTAINER} ${SCRATCH}; docker network rm ${SCRATCH_NETWORK}"; return; }
	docker rm -fv "${PANEL_CONTAINER}" >/dev/null 2>&1 || true
	docker rm -fv "${SCRATCH}" >/dev/null 2>&1 || true
	docker network rm "${SCRATCH_NETWORK}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ── 1. locate the dump ───────────────────────────────────────────────────────
find_dump() {
	local dir="${SEARCH_DIR:-${CONFIG_DIR}/backups}"
	[ -d "${dir}" ] || die "No dump given and ${dir} does not exist — pass --dump <file.sql.gz>"
	# Select instance SQL or pre-update SQL, never a newer config/volume archive.
	local found
	found="$(find "${dir}" -type f \( -name '*.sql.gz' -o -path '*/web-server/*.gz' \) -print0 2>/dev/null \
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

docker network create --internal "${SCRATCH_NETWORK}" >/dev/null \
	|| die "Could not create the isolated scratch network"
info "scratch postgres: ${SCRATCH} (${PG_IMAGE}; inspect with docker exec)"
docker run -d --name "${SCRATCH}" \
	--network "${SCRATCH_NETWORK}" \
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
		psql -q -U nixploy -d nixploy --single-transaction -v ON_ERROR_STOP=1 >"${log}" 2>&1; then
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
	printf '\n   %sBooting %s against the restored database%s\n' "${C_BOLD}" "${PANEL_IMAGE}" "${C_RESET}"
	# Restore keys without placing them on argv. No worker/crons, no external
	# network: recovered notification destinations must not receive drill events.
	# The explicit socket must belong to a disposable daemon, never production.
	docker run -d --name "${PANEL_CONTAINER}" \
		--network "${SCRATCH_NETWORK}" \
		--env-file "${RECOVERY_ENV}" \
		--mount "type=bind,source=${DOCKER_SOCKET},target=/var/run/docker.sock,readonly" \
		-e "DATABASE_URL=postgres://nixploy:nixploy@${SCRATCH}:5432/nixploy" \
		-e PORT=3000 \
		-e BETTER_AUTH_URL=http://127.0.0.1:3000 \
		-e NIXPLOY_ROLE=panel \
		-e DOCKER_SOCKET=/var/run/docker.sock \
		-e NIXPLOY_DISABLE_TRAEFIK_BOOT=1 \
		-e NIXPLOY_CONFIG_DIR=/tmp/nixploy-dr \
		"${PANEL_IMAGE}" >/dev/null || die "Could not start the requested panel container"
	local code="" tries=0
	while [ "${tries}" -lt 90 ]; do
		code="$(docker exec "${PANEL_CONTAINER}" curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
			"http://127.0.0.1:3000/api/ready" 2>/dev/null || true)"
		[ "${code}" = "200" ] && break
		docker inspect -f '{{.State.Running}}' "${PANEL_CONTAINER}" 2>/dev/null | grep -qx true || break
		sleep 2
		tries=$((tries + 1))
	done
	if [ "${code}" = "200" ]; then
		ok "Panel booted and /api/ready answered 200 against the restored database"
		info "Readiness only: authenticate, check decrypted secrets, restore config/data and verify workload traffic separately"
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
