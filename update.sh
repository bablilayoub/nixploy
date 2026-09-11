#!/usr/bin/env bash
#
# Nixploy updater — pull the latest image and roll the Swarm services.
#
#   curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/update.sh | sudo bash
#
# Safe: keeps /etc/nixploy/.env, Postgres data, Traefik ACME certs and
# dynamic routes. Migrations run automatically when the new container starts.
# A new image that fails its health check is rolled back by Swarm
# (--update-failure-action rollback); `docker service rollback nixploy` does
# the same by hand.
#
# Environment overrides:
#   NIXPLOY_VERSION              App image tag                 (default: v0.1.0)
#   NIXPLOY_IMAGE                Full image ref (overrides tag)
#   NIXPLOY_CONFIG_DIR           Host config directory         (default: /etc/nixploy)
#   NIXPLOY_PORT                 Host port :3000 is published on. Auto-detected from the
#                                service when unset; only used as an extra readiness probe.
#   TRUSTED_PROXIES              Forwarded to the app          (default: 1 — Traefik fronts it)
#   LOG_LEVEL / LOG_FORMAT       Forwarded to the app when set (debug|info|warn|error / json)
#   DATABASE_POOL_MAX            Forwarded to the app when set
#   NIXPLOY_NETWORK              Shared tenant overlay         (default: nixploy-network).
#                                Forwarded to the app when set; the panel and Postgres
#                                are moved onto `nixploy-internal` on the first run
#                                after upgrading (idempotent, see migrate_internal_network).
#   NIXPLOY_LETSENCRYPT_EMAIL    Replace the ACME email in traefik.yml (default: keep)
#   TRAEFIK_VERSION              Traefik image tag             (default: v3.5.0)
#   NIXPLOY_UPDATE_TRAEFIK       1 = also pull & force Traefik  (default: 1)
#   NIXPLOY_UPDATE_POSTGRES_SPEC 1 = apply the pg_isready healthcheck, rotated json-file
#                                logs and the 60 s stop grace to an older nixploy-postgres
#                                service (default: 0 — it restarts Postgres once)
#   TZ                           Process timezone of the panel; every cron runs in it
#                                (default: UTC). Forwarded when set, like every other
#                                runtime knob in docs/install.md → "Runtime environment"
#   NIXPLOY_REFRESH_TRAEFIK_YML  1 = re-render static traefik.yml, keeping the ACME email (default: 1)
#   NIXPLOY_PRUNE                1 = prune dangling images     (default: 1)
#   NIXPLOY_PRE_UPDATE_BACKUP    1 = pg_dump the platform DB to <config>/backups before
#                                rolling (default: 1; the last 3 dumps are kept)
#   NIXPLOY_ALLOW_DOWNGRADE      1 = allow rolling to a LOWER semver tag (default: refuse —
#                                migrations are forward-only; restore a dump first)
#   NIXPLOY_MEMORY_LIMIT         Memory limit of the nixploy service (default: 2g)
#   NIXPLOY_BUILD_FROM_SOURCE    1 = build locally instead of pull (opt-in only)
#   NIXPLOY_REPO                 GitHub org/repo               (default: bablilayoub/nixploy)
#   NIXPLOY_BRANCH               Branch for source builds      (default: the image tag)
#   NIXPLOY_GITHUB_TOKEN         Fine-grained PAT (Contents: Read) for private repos.
#                                Also accepts GITHUB_TOKEN. Required under sudo when
#                                the repo is private — root does not see your user gitconfig.
#   NIXPLOY_RENDER_TRAEFIK_ONLY  1 = print the static traefik.yml this script writes, then exit
#
set -euo pipefail

NIXPLOY_VERSION="${NIXPLOY_VERSION:-v0.1.0}"
NIXPLOY_CONFIG_DIR="${NIXPLOY_CONFIG_DIR:-/etc/nixploy}"
# Host-side directory; re-asserted after sourcing .env (older installs stored
# the container path there).
HOST_CONFIG_DIR="${NIXPLOY_CONFIG_DIR}"
TRAEFIK_VERSION="${TRAEFIK_VERSION:-v3.5.0}"
NIXPLOY_REPO="${NIXPLOY_REPO:-bablilayoub/nixploy}"
# Pin source builds to the same release tag as the image unless overridden.
NIXPLOY_BRANCH="${NIXPLOY_BRANCH:-$NIXPLOY_VERSION}"
NIXPLOY_UPDATE_TRAEFIK="${NIXPLOY_UPDATE_TRAEFIK:-1}"
NIXPLOY_REFRESH_TRAEFIK_YML="${NIXPLOY_REFRESH_TRAEFIK_YML:-1}"
NIXPLOY_PRUNE="${NIXPLOY_PRUNE:-1}"
NIXPLOY_PRE_UPDATE_BACKUP="${NIXPLOY_PRE_UPDATE_BACKUP:-1}"
NIXPLOY_MEMORY_LIMIT="${NIXPLOY_MEMORY_LIMIT:-2g}"

APP_IMAGE="${NIXPLOY_IMAGE:-ghcr.io/bablilayoub/nixploy:${NIXPLOY_VERSION}}"
TRAEFIK_IMAGE="traefik:${TRAEFIK_VERSION}"
ENV_FILE="${NIXPLOY_CONFIG_DIR}/.env"
LOG_FILE="/var/log/nixploy-update.log"
ACME_EMAIL_UNSET="nixploy@localhost"

# ── output helpers ───────────────────────────────────────────────────────────
if [ -t 1 ] && [ "${NO_COLOR:-}" = "" ]; then
	C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
	C_CYAN=$'\033[36m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
	C_RED=$'\033[31m'; C_BLUE=$'\033[34m'
	IS_TTY=1
else
	C_RESET=""; C_BOLD=""; C_DIM=""; C_CYAN=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_BLUE=""
	IS_TTY=0
fi

STEP=0
TOTAL_STEPS=6

banner() {
	printf '\n%s' "${C_CYAN}${C_BOLD}"
	cat <<'EOF'
    _   ___            __
   / | / (_)  ______  / /___  __  __
  /  |/ / / |/_/ __ \/ / __ \/ / / /
 / /|  / />  </ /_/ / / /_/ / /_/ /
/_/ |_/_/_/|_/ .___/_/\____/\__, /
            /_/            /____/
EOF
	printf '%s\n' "${C_RESET}${C_DIM}  Update · pull image · roll services · keep your data${C_RESET}"
	printf '\n'
}

progress_bar() {
	local width=28 filled fill="" todo="" i
	filled=$((STEP * width / TOTAL_STEPS))
	for ((i = 0; i < filled; i++)); do fill+="━"; done
	for ((i = filled; i < width; i++)); do todo+="─"; done
	printf '%s%s%s%s%s' "${C_GREEN}" "${fill}" "${C_DIM}" "${todo}" "${C_RESET}"
}

step() {
	STEP=$((STEP + 1))
	printf '\n %s %s%d/%d%s %s%s%s\n' "$(progress_bar)" "${C_BLUE}${C_BOLD}" "$STEP" "$TOTAL_STEPS" "${C_RESET}" "${C_BOLD}" "$*" "${C_RESET}"
}

ok()   { printf '   %s✓%s %s\n' "${C_GREEN}" "${C_RESET}" "$*"; }
info() { printf '   %s•%s %s\n' "${C_CYAN}" "${C_RESET}" "$*"; }
warn() { printf '   %s!%s %s\n' "${C_YELLOW}" "${C_RESET}" "$*" >&2; }
die()  { printf '\n   %s✗ ERROR:%s %s\n\n' "${C_RED}${C_BOLD}" "${C_RESET}" "$*" >&2; exit 1; }

run_quiet() {
	local label="$1"
	shift
	printf '%s\n── %s ──\n' "$(date -u +%H:%M:%S)" "${label}" >> "${LOG_FILE}" 2>/dev/null || true
	if [ "${IS_TTY}" = "1" ]; then
		"$@" >> "${LOG_FILE}" 2>&1 &
		local pid=$! frames='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏' i=0
		while kill -0 "${pid}" 2>/dev/null; do
			printf '\r   %s%s%s %s' "${C_CYAN}" "${frames:i%10:1}" "${C_RESET}" "${label}"
			i=$((i + 1))
			sleep 0.15
		done
		printf '\r\033[K'
		if wait "${pid}"; then
			ok "${label}"
		else
			warn "${label} failed — last log lines:"
			tail -n 25 "${LOG_FILE}" >&2 2>/dev/null || true
			return 1
		fi
	else
		info "${label}…"
		if "$@" >> "${LOG_FILE}" 2>&1; then
			ok "${label}"
		else
			warn "${label} failed — last log lines:"
			tail -n 25 "${LOG_FILE}" >&2 2>/dev/null || true
			return 1
		fi
	fi
}

need_cmd() { command -v "$1" >/dev/null 2>&1; }

# "https://x.com/y" → "x.com"; "1.2.3.4:443" → "1.2.3.4"
url_host() {
	local h="${1#http://}"
	h="${h#https://}"
	h="${h%%/*}"
	h="${h%%:*}"
	printf '%s' "${h}"
}

# Source .env (exporting everything) and re-assert the host config dir.
load_env_file() {
	set -a
	# shellcheck disable=SC1090
	. "${ENV_FILE}"
	set +a
	NIXPLOY_CONFIG_DIR="${HOST_CONFIG_DIR}"
	ENV_FILE="${HOST_CONFIG_DIR}/.env"
}

# ── preflight ────────────────────────────────────────────────────────────────
require_root() {
	[ "$(id -u)" -eq 0 ] || die "Run as root: curl -fsSL <url> | sudo bash"
}

require_install() {
	need_cmd docker || die "Docker is not installed — run install.sh first"
	docker info >/dev/null 2>&1 || die "Docker daemon is not running"
	local state
	state="$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || true)"
	[ "${state}" = "active" ] || die "Docker Swarm is not active — run install.sh first"

	docker service inspect nixploy >/dev/null 2>&1 \
		|| die "Service 'nixploy' not found — run install.sh first"
	docker service inspect nixploy-postgres >/dev/null 2>&1 \
		|| die "Service 'nixploy-postgres' not found — run install.sh first"
	docker service inspect nixploy-traefik >/dev/null 2>&1 \
		|| die "Service 'nixploy-traefik' not found — run install.sh first"

	[ -f "${ENV_FILE}" ] || die "Missing ${ENV_FILE} — run install.sh first"
	load_env_file

	local current
	current="$(docker service inspect nixploy --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' 2>/dev/null || true)"
	ok "Current image: ${current:-unknown}"
	ok "Target image:  ${APP_IMAGE}"
	check_downgrade "${current}"
}

# Tag of an image ref: "ghcr.io/x/nixploy:v0.2.0@sha256:…" → "v0.2.0" ("" when untagged).
image_tag() {
	local ref="${1%%@*}"
	ref="${ref##*/}"
	case "${ref}" in
		*:*) printf '%s' "${ref##*:}" ;;
		*) printf '' ;;
	esac
}

is_semver() {
	[[ "${1:-}" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+([-+].*)?$ ]]
}

# True when $1 < $2 (semver, optional "v" prefix, pre-release/build ignored).
semver_lt() {
	local a="${1#v}" b="${2#v}" a1 a2 a3 b1 b2 b3
	a="${a%%[-+]*}"; b="${b%%[-+]*}"
	IFS=. read -r a1 a2 a3 <<<"${a}"
	IFS=. read -r b1 b2 b3 <<<"${b}"
	[ "${a1}" -lt "${b1}" ] && return 0
	[ "${a1}" -gt "${b1}" ] && return 1
	[ "${a2}" -lt "${b2}" ] && return 0
	[ "${a2}" -gt "${b2}" ] && return 1
	[ "${a3}" -lt "${b3}" ]
}

# Migrations are forward-only: older code on a newer schema is undefined.
# Refuse a lower semver tag unless NIXPLOY_ALLOW_DOWNGRADE=1 (after restoring
# the matching pre-update dump — see docs/install.md).
check_downgrade() {
	local current_tag target_tag
	current_tag="$(image_tag "${1:-}")"
	target_tag="$(image_tag "${APP_IMAGE}")"
	if ! is_semver "${current_tag}" || ! is_semver "${target_tag}"; then
		info "Downgrade guard skipped (${current_tag:-untagged} → ${target_tag:-untagged}: not both semver)"
		return 0
	fi
	if semver_lt "${target_tag}" "${current_tag}"; then
		if [ "${NIXPLOY_ALLOW_DOWNGRADE:-0}" = "1" ]; then
			warn "Downgrading ${current_tag} → ${target_tag} (NIXPLOY_ALLOW_DOWNGRADE=1). Restore the pre-update dump taken before ${current_tag} first, or the old code runs on a newer schema."
		else
			die "Refusing to downgrade ${current_tag} → ${target_tag}: migrations are forward-only. Restore the matching dump from ${HOST_CONFIG_DIR}/backups (docs/install.md → Downgrade), then re-run with NIXPLOY_ALLOW_DOWNGRADE=1."
		fi
	fi
}

# ── image ────────────────────────────────────────────────────────────────────
# Clone URL for private repos: embed the PAT so `sudo` does not prompt for a password.
repo_clone_url() {
	local token="${NIXPLOY_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}"
	if [ -n "${token}" ]; then
		printf 'https://x-access-token:%s@github.com/%s.git' "${token}" "${NIXPLOY_REPO}"
	else
		printf 'https://github.com/%s.git' "${NIXPLOY_REPO}"
	fi
}

# "version" from a package.json without needing node on the host.
read_pkg_version() {
	sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$1" 2>/dev/null | head -n 1
}

build_app_image() {
	need_cmd git || die "git is required to build from source"
	local tmp version
	tmp="$(mktemp -d)"
	info "Building from source — this takes several minutes"
	if ! run_quiet "Cloning ${NIXPLOY_REPO}@${NIXPLOY_BRANCH}" \
		git clone --depth 1 --branch "${NIXPLOY_BRANCH}" "$(repo_clone_url)" "${tmp}/src"; then
		rm -rf "${tmp}"
		die "Clone failed — for a private repo export NIXPLOY_GITHUB_TOKEN (Contents: Read) and re-run with sudo -E"
	fi
	# Settings → Updates shows this; without it every source build reports the image default.
	version="$(read_pkg_version "${tmp}/src/package.json")"
	version="${version:-${NIXPLOY_VERSION#v}}"
	if ! run_quiet "Building ${APP_IMAGE} (v${version})" \
		docker build -t "${APP_IMAGE}" -f "${tmp}/src/docker/Dockerfile" \
			--build-arg "NIXPLOY_APP_VERSION=${version}" "${tmp}/src"; then
		rm -rf "${tmp}"
		die "Build failed — full log: ${LOG_FILE}"
	fi
	rm -rf "${tmp}"
}

pull_app_image() {
	if [ "${NIXPLOY_BUILD_FROM_SOURCE:-0}" = "1" ]; then
		build_app_image
		return
	fi
	if run_quiet "Pulling ${APP_IMAGE}" docker pull "${APP_IMAGE}"; then
		return
	fi
	die "Pull failed for ${APP_IMAGE}. Set NIXPLOY_BUILD_FROM_SOURCE=1 to build from git, or pin NIXPLOY_VERSION / NIXPLOY_IMAGE."
}

# ── config ───────────────────────────────────────────────────────────────────
# Static Traefik config. Keep byte-identical to install.sh,
# packages/server/src/modules/traefik/setup.ts#buildTraefikStaticConfig and
# docker/traefik/traefik.yml — CI renders all of them and diffs.
#
# No entrypoint-level HTTP → HTTPS redirect: it would override every domain's
# `https` toggle. The panel emits a per-router `redirectScheme` middleware for
# each `https: true` domain, so `https: false` domains stay plain on :80.
# Installs made before that change carry the old redirect block in their
# traefik.yml; re-rendering here removes it (see refresh_traefik_yml).
render_traefik_static() {
	local email="${1:-${ACME_EMAIL_UNSET}}"
	cat <<EOF
global:
  checkNewVersion: false
  sendAnonymousUsage: false
log:
  level: ERROR
entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"
providers:
  file:
    directory: /etc/nixploy/traefik/dynamic
    watch: true
certificatesResolvers:
  letsencrypt:
    acme:
      email: ${email}
      storage: /etc/nixploy/traefik/acme.json
      httpChallenge:
        entryPoint: web
api:
  dashboard: false
EOF
}

# Set when the rendered static config differs from what is on disk — Traefik
# reads traefik.yml once at start, so the proxy has to be restarted for it.
TRAEFIK_YML_CHANGED=0

refresh_traefik_yml() {
	[ "${NIXPLOY_REFRESH_TRAEFIK_YML}" = "1" ] || {
		ok "Keeping existing traefik.yml"
		return
	}
	local file="${NIXPLOY_CONFIG_DIR}/traefik/traefik.yml"
	mkdir -p "${NIXPLOY_CONFIG_DIR}/traefik/dynamic"
	local email="${NIXPLOY_LETSENCRYPT_EMAIL:-}"
	if [ -z "${email}" ]; then
		# Keep the ACME contact already in the static config (the Let's Encrypt
		# account is tied to it); older templates carried a placeholder.
		email="$(awk -F': *' '/^[[:space:]]*email:/{print $2; exit}' "${file}" 2>/dev/null || true)"
		[ "${email}" != "admin@example.com" ] || email=""
		email="${email:-${ACME_EMAIL_UNSET}}"
	fi
	# Marker of the pre-v0.2.0 template: an entrypoint-level redirection block
	# under entryPoints.web. Nothing else in the file uses `redirections`.
	local had_redirect=0
	if [ -f "${file}" ] && grep -q 'redirections:' "${file}" 2>/dev/null; then
		had_redirect=1
	fi
	# Rendered locally (no network): fixes drift from older templates that
	# enabled INFO logging + accessLog on the unrotated json-file driver, and
	# removes the entrypoint-level HTTP → HTTPS redirect that pre-empted the
	# per-domain `https` toggle.
	local rendered
	rendered="$(render_traefik_static "${email}")"
	if [ ! -f "${file}" ] || [ "${rendered}" != "$(cat "${file}")" ]; then
		TRAEFIK_YML_CHANGED=1
	fi
	printf '%s\n' "${rendered}" > "${file}"
	if [ "${had_redirect}" = "1" ]; then
		ok "Removed the global HTTP → HTTPS redirect from traefik.yml"
		info "Domains with HTTPS enabled keep redirecting (per-router middleware); domains with HTTPS off are now served plain on :80."
	fi
	if [ "${email}" = "${ACME_EMAIL_UNSET}" ]; then
		ok "Refreshed traefik.yml (no ACME email)"
		warn "Let's Encrypt is unavailable until an email is set: NIXPLOY_LETSENCRYPT_EMAIL=… update.sh, or Settings → Platform → Let's Encrypt email."
	else
		ok "Refreshed traefik.yml (ACME email: ${email})"
	fi
}

# ── pre-update backup ────────────────────────────────────────────────────────
# Swarm's rollback restores the previous IMAGE, not the previous database:
# a migration that partially applied stays applied. A pg_dump right before
# the roll makes "roll back" mean the previous state too.
BACKUP_DIR="${HOST_CONFIG_DIR}/backups"
BACKUP_FILE=""
BACKUP_KEEP=3

postgres_container() {
	docker ps --filter label=com.docker.swarm.service.name=nixploy-postgres --format '{{.ID}}' 2>/dev/null | head -n 1 || true
}

backup_database() {
	if [ "${NIXPLOY_PRE_UPDATE_BACKUP}" != "1" ]; then
		warn "Pre-update database backup skipped (NIXPLOY_PRE_UPDATE_BACKUP=0)"
		return 0
	fi
	local container tag stamp size
	container="$(postgres_container)"
	[ -n "${container}" ] || die "nixploy-postgres container not found on this node — cannot take the pre-update backup (NIXPLOY_PRE_UPDATE_BACKUP=0 skips it)"
	tag="$(image_tag "${APP_IMAGE}")"
	tag="$(printf '%s' "${tag:-image}" | tr -c 'A-Za-z0-9._-' '-')"
	stamp="$(date -u +%Y%m%dT%H%M%SZ)"
	mkdir -p "${BACKUP_DIR}"
	chmod 700 "${BACKUP_DIR}"
	BACKUP_FILE="${BACKUP_DIR}/pre-update-${tag}-${stamp}.sql.gz"
	# --clean --if-exists: the dump restores over a non-empty database with a
	# single psql. Credentials stay inside the postgres container.
	if ! docker exec "${container}" sh -c 'pg_dump --clean --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB"' \
		| gzip > "${BACKUP_FILE}"; then
		rm -f "${BACKUP_FILE}"
		die "pg_dump failed — not rolling. Check: docker service logs nixploy-postgres (NIXPLOY_PRE_UPDATE_BACKUP=0 skips the backup)"
	fi
	size="$(wc -c < "${BACKUP_FILE}" | tr -d ' ')"
	if [ "${size:-0}" -lt 200 ]; then
		rm -f "${BACKUP_FILE}"
		die "pg_dump produced an empty dump — not rolling (NIXPLOY_PRE_UPDATE_BACKUP=0 skips the backup)"
	fi
	chmod 600 "${BACKUP_FILE}"
	ok "Database dumped to ${BACKUP_FILE} ($((size / 1024)) KiB)"
	info "Restore: gunzip -c ${BACKUP_FILE} | docker exec -i \$(docker ps -q -f label=com.docker.swarm.service.name=nixploy-postgres) psql -q -U ${POSTGRES_USER:-nixploy} -d ${POSTGRES_DB:-nixploy}"
	# Keep the newest BACKUP_KEEP dumps. The names are generated above from
	# [A-Za-z0-9._-] plus a UTC stamp, so sorting ls output by mtime is safe.
	local old
	# shellcheck disable=SC2012
	ls -1t "${BACKUP_DIR}"/pre-update-*.sql.gz 2>/dev/null | tail -n +"$((BACKUP_KEEP + 1))" | while IFS= read -r old; do
		rm -f "${old}"
	done
}

# ── network segmentation ─────────────────────────────────────────────────────
# Shared, Traefik-facing tenant overlay; only routed tenant services join it.
NETWORK_NAME="${NIXPLOY_NETWORK:-nixploy-network}"
# Panel ↔ Postgres. No tenant workload is ever attached to it.
INTERNAL_NETWORK_NAME="nixploy-internal"

ensure_network() {
	local name="$1"
	docker network inspect "${name}" >/dev/null 2>&1 && return 0
	if docker network create --driver overlay --attachable "${name}" >/dev/null; then
		ok "Created network ${name}"
	else
		warn "Could not create network ${name}"
	fi
}

# Whether a swarm service is already attached to a network (spec stores ids).
service_on_network() {
	local service="$1" network="$2" id
	id="$(docker network inspect "${network}" --format '{{.Id}}' 2>/dev/null || true)"
	[ -n "${id}" ] || return 1
	docker service inspect "${service}" \
		--format '{{range .Spec.TaskTemplate.Networks}}{{.Target}} {{end}}' 2>/dev/null \
		| tr ' ' '\n' | grep -qx "${id}"
}

attach_internal_network() {
	local service="$1"
	docker service inspect "${service}" >/dev/null 2>&1 || return 0
	service_on_network "${service}" "${INTERNAL_NETWORK_NAME}" && return 0
	if docker service update --network-add "${INTERNAL_NETWORK_NAME}" "${service}" >/dev/null 2>&1; then
		ok "Attached ${service} to ${INTERNAL_NETWORK_NAME}"
	else
		warn "Could not attach ${service} to ${INTERNAL_NETWORK_NAME}"
	fi
}

detach_tenant_network() {
	local service="$1"
	docker service inspect "${service}" >/dev/null 2>&1 || return 0
	service_on_network "${service}" "${NETWORK_NAME}" || return 0
	# Never strand a service with no network at all.
	if ! service_on_network "${service}" "${INTERNAL_NETWORK_NAME}"; then
		warn "${service} is not on ${INTERNAL_NETWORK_NAME} yet — leaving ${NETWORK_NAME} attached"
		return 0
	fi
	if docker service update --network-rm "${NETWORK_NAME}" "${service}" >/dev/null 2>&1; then
		ok "Detached ${service} from ${NETWORK_NAME}"
	else
		warn "Could not detach ${service} from ${NETWORK_NAME}"
	fi
}

# One-time (idempotent) migration for installs made before tenant network
# segmentation: `nixploy` and `nixploy-postgres` used to sit on the shared
# tenant overlay, where any application container could resolve `nixploy:3000`
# and `nixploy-postgres:5432`.
#
# Order matters — Traefik must reach the panel on the new network before the
# panel leaves the old one, and Postgres must be reachable before the panel
# moves. Each `--network-add`/`--network-rm` recreates the service's tasks.
migrate_internal_network() {
	ensure_network "${NETWORK_NAME}"
	ensure_network "${INTERNAL_NETWORK_NAME}"
	attach_internal_network nixploy-traefik
	attach_internal_network nixploy-postgres
	detach_tenant_network nixploy-postgres
	attach_internal_network nixploy
	detach_tenant_network nixploy
}

# ── roll services ────────────────────────────────────────────────────────────
LOG_ARGS=(--log-driver json-file --log-opt max-size=10m --log-opt max-file=3)
ROLL_ARGS=(
	--update-order stop-first
	--update-failure-action rollback
	--update-monitor 60s
	--rollback-order stop-first
)
# Service spec: 90 s for the SIGTERM handler to finish in-flight deploys; a
# memory ceiling so a runaway build log cannot take the host down with the
# panel, and a reservation so Swarm never co-schedules it onto nothing.
SERVICE_ARGS=(
	--stop-grace-period 90s
	--limit-memory "${NIXPLOY_MEMORY_LIMIT}"
	--reserve-memory 512m
)

# Runtime knobs forwarded to the `nixploy` service, only when set (values
# already on the service are kept — `--env-add` never removes anything).
# Documented in docs/install.md → "Runtime environment"; keep in sync with
# install.sh's copy.
FORWARDED_APP_ENV=(
	LOG_LEVEL
	LOG_FORMAT
	DATABASE_POOL_MAX
	NIXPLOY_NETWORK
	NIXPLOY_WILDCARD_DOMAIN
	NIXPLOY_DEPLOY_CONCURRENCY
	NIXPLOY_DEPLOY_TIMEOUT_MS
	NIXPLOY_COMMAND_TIMEOUT_MS
	NIXPLOY_REMOTE_COMMAND_TIMEOUT_MS
	NIXPLOY_SHUTDOWN_GRACE_MS
	NIXPLOY_DB_WAIT_SECONDS
	NIXPLOY_AUDIT_RETENTION_DAYS
	NIXPLOY_CRON_CATCH_UP
	NIXPLOY_SCHEDULES_LOG_PATH
	NIXPLOY_INSTANCE_BACKUP_ALERT_DAYS
	NIXPLOY_DOCKER_CLEANUP_CRON
	NIXPLOY_BASE_URL
	DOCKER_SOCKET
	LISTEN_HOST
	TZ
)

APP_ENV_ARGS=()
collect_app_env_args() {
	local flag="$1" name
	APP_ENV_ARGS=(
		"${flag}" "TRUSTED_PROXIES=${TRUSTED_PROXIES:-1}"
		"${flag}" "NIXPLOY_IMAGE=${APP_IMAGE}"
		"${flag}" "NIXPLOY_CONFIG_DIR=/etc/nixploy"
		"${flag}" "NIXPLOY_DISABLE_TRAEFIK_BOOT=1"
	)
	if [ -n "${BETTER_AUTH_URL:-}" ]; then
		APP_ENV_ARGS+=("${flag}" "BETTER_AUTH_URL=${BETTER_AUTH_URL}")
	fi
	for name in "${FORWARDED_APP_ENV[@]}"; do
		if [ -n "${!name:-}" ]; then
			APP_ENV_ARGS+=("${flag}" "${name}=${!name}")
		fi
	done
}

update_app() {
	# --no-resolve-image: use the local tag after a source build; otherwise
	# Swarm can hang trying to re-resolve against GHCR.
	# --force: recreate even when the image tag string is unchanged (e.g. :latest).
	# --update-order stop-first: a host-published port can never be bound by a
	# second task while the old one runs (start-first deadlocks).
	# --update-failure-action rollback: the image HEALTHCHECK gates readiness;
	# a task that dies within the monitor window rolls back to the old spec.
	collect_app_env_args --env-add
	docker service update \
		--detach \
		--force \
		--no-resolve-image \
		--image "${APP_IMAGE}" \
		"${ROLL_ARGS[@]}" \
		"${SERVICE_ARGS[@]}" \
		"${LOG_ARGS[@]}" \
		"${APP_ENV_ARGS[@]}" \
		nixploy >/dev/null
	ok "Rolling nixploy → ${APP_IMAGE}"
}

# Installs made before the Postgres hardening have no healthcheck, unbounded
# json-file logs and the default 10 s stop grace (a checkpoint can outlive it,
# which is how a database gets a dirty shutdown on every update).
#
# Applying it recreates the Postgres task — one short outage of the panel's
# database — so it is opt-in behind NIXPLOY_UPDATE_POSTGRES_SPEC=1 rather than
# silently part of an update. It is idempotent: re-running changes nothing.
update_postgres_spec() {
	[ "${NIXPLOY_UPDATE_POSTGRES_SPEC:-0}" = "1" ] || return 0
	docker service inspect nixploy-postgres >/dev/null 2>&1 || {
		warn "Service nixploy-postgres not found — skipping the spec update"
		return 0
	}
	info "Applying the healthcheck, log rotation and 60 s stop grace to nixploy-postgres (one restart)"
	if docker service update \
		--detach=false \
		--health-cmd 'pg_isready -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
		--health-interval 10s --health-timeout 5s --health-retries 5 --health-start-period 30s \
		--stop-grace-period 60s \
		"${LOG_ARGS[@]}" \
		nixploy-postgres >/dev/null 2>&1; then
		ok "Updated the nixploy-postgres service spec"
	else
		warn "Could not update the nixploy-postgres spec — check: docker service ps nixploy-postgres"
	fi
}

# Traefik loads traefik.yml once at start; a rewritten static config only takes
# effect when the task is recreated.
restart_traefik_for_static_config() {
	[ "${TRAEFIK_YML_CHANGED}" = "1" ] || return 0
	if docker service update --detach --force nixploy-traefik >/dev/null 2>&1; then
		ok "Restarted nixploy-traefik to pick up the new static config"
	else
		warn "Could not restart nixploy-traefik — run: docker service update --force nixploy-traefik"
	fi
}

update_traefik() {
	[ "${NIXPLOY_UPDATE_TRAEFIK}" = "1" ] || {
		ok "Skipping Traefik update"
		restart_traefik_for_static_config
		return
	}
	run_quiet "Pulling ${TRAEFIK_IMAGE}" docker pull "${TRAEFIK_IMAGE}" || {
		warn "Traefik pull failed — leaving current Traefik running"
		restart_traefik_for_static_config
		return
	}
	docker service update \
		--detach \
		--force \
		--image "${TRAEFIK_IMAGE}" \
		"${LOG_ARGS[@]}" \
		nixploy-traefik >/dev/null
	ok "Rolling nixploy-traefik → ${TRAEFIK_IMAGE}"
}

# ── readiness ────────────────────────────────────────────────────────────────
# Host port currently published for the app's :3000 (empty when none).
app_published_port() {
	docker service inspect nixploy \
		--format '{{if .Spec.EndpointSpec}}{{range .Spec.EndpointSpec.Ports}}{{.TargetPort}}:{{.PublishedPort}} {{end}}{{end}}' 2>/dev/null \
		| tr ' ' '\n' | awk -F: '$1 == 3000 { print $2; exit }' || true
}

# Through Traefik on loopback with the real host name: works before DNS has
# propagated and does not need :3000 published. $1 = host, $2 = path. Prints
# the HTTP status ("" on connection failure).
probe_via_traefik() {
	curl -sk -o /dev/null -w '%{http_code}' --connect-timeout 2 --max-time 12 \
		--resolve "${1}:443:127.0.0.1" "https://${1}${2}" 2>/dev/null || true
}

# $1 = host port, $2 = path.
probe_via_port() {
	curl -s -o /dev/null -w '%{http_code}' --connect-timeout 2 --max-time 12 \
		"http://127.0.0.1:${1}${2}" 2>/dev/null || true
}

# /setup answers 200 (first boot) or a redirect to /login once an owner exists.
is_ready_code() {
	case "${1:-}" in 200|302|307|308) return 0 ;; esac
	return 1
}

# Readiness is GET /api/ready — 200 only when Postgres, the docker socket and
# the migration state are healthy (docs/observability.md). Images that predate
# the endpoint answer 404; those fall back to the /setup probe.
# $1 = probe function, $2 = its target (host or port).
probe_ready() {
	local code
	code="$("$1" "$2" /api/ready)"
	case "${code}" in
		200) return 0 ;;
		404) is_ready_code "$("$1" "$2" /setup)" && return 0 ;;
	esac
	return 1
}

app_is_ready() {
	local host="$1" port="${2:-}"
	probe_ready probe_via_traefik "${host}" && return 0
	[ -n "${port}" ] && probe_ready probe_via_port "${port}" && return 0
	return 1
}

# Swarm update state of the nixploy service.
app_update_state() {
	docker service inspect nixploy --format '{{if .UpdateStatus}}{{.UpdateStatus.State}}{{end}}' 2>/dev/null || true
}

wait_for_app() {
	local url host port state="" ready=0 i
	url="${BETTER_AUTH_URL:-}"
	if [ -z "${url}" ]; then
		local ip
		ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}' || true)"
		url="https://${ip:-127.0.0.1}"
	fi
	host="$(url_host "${url}")"
	port="${NIXPLOY_PORT:-$(app_published_port)}"

	# The old task is stopped first; give Swarm a moment so we don't read the
	# old container as "ready".
	sleep 3
	local frames='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
	for i in $(seq 1 120); do
		if app_is_ready "${host}" "${port}"; then
			ready=1
			break
		fi
		state="$(app_update_state)"
		case "${state}" in
			rollback_*|paused) break ;;
		esac
		if [ "${IS_TTY}" = "1" ]; then
			printf '\r   %s%s%s Waiting for the new container (%d/120)' \
				"${C_CYAN}" "${frames:i%10:1}" "${C_RESET}" "$i"
		fi
		sleep 2
	done
	[ "${IS_TTY}" != "1" ] || printf '\r\033[K'

	state="$(app_update_state)"
	case "${state}" in
		rollback_*)
			warn "Swarm rolled the nixploy service back (update state: ${state})"
			docker service ps nixploy --no-trunc 2>/dev/null | head -n 6 >&2 || true
			docker service logs --tail 50 nixploy >&2 2>/dev/null || true
			die "Update failed: ${APP_IMAGE} did not pass its health check and the previous version is running again. Inspect: docker service ps nixploy · logs: docker service logs nixploy"
			;;
		paused)
			warn "Swarm paused the update (state: paused)"
			;;
	esac
	if [ "${ready}" != "1" ]; then
		warn "App not responding after ~4 minutes"
		docker service ps nixploy --no-trunc 2>/dev/null | head -n 6 >&2 || true
		docker service logs --tail 50 nixploy >&2 2>/dev/null || true
		die "Update failed — debug: docker service logs -f nixploy · roll back: docker service rollback nixploy"
	fi
	ok "App is up (via Traefik on this host)"

	local running
	running="$(docker service inspect nixploy --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' 2>/dev/null || true)"
	case "${running}" in
		"${APP_IMAGE}"|"${APP_IMAGE}@"*) ;;
		*) warn "Service spec image is ${running:-unknown}, expected ${APP_IMAGE} — check: docker service ps nixploy" ;;
	esac

	# Public reachability is informational only.
	local code
	code="$(curl -sk -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 8 "${url}/setup" 2>/dev/null || true)"
	if is_ready_code "${code}"; then
		ok "HTTPS ready at ${url}"
	else
		warn "${url} did not answer from this host (DNS/NAT/firewall?) — the panel itself is up."
	fi
}

prune_images() {
	[ "${NIXPLOY_PRUNE}" = "1" ] || return 0
	# Only dangling images — never touch tagged ones still in use.
	if docker image prune -f >/dev/null 2>&1; then
		ok "Pruned dangling images"
	fi
}

print_summary() {
	local url="${BETTER_AUTH_URL:-https://$(hostname -I 2>/dev/null | awk '{print $1}')}"
	local image
	image="$(docker service inspect nixploy --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' 2>/dev/null || echo "${APP_IMAGE}")"
	printf '\n'
	printf '  %s╭──────────────────────────────────────────────╮%s\n' "${C_GREEN}" "${C_RESET}"
	printf '  %s│%s        %s✓ Nixploy is up to date%s               %s│%s\n' "${C_GREEN}" "${C_RESET}" "${C_BOLD}" "${C_RESET}" "${C_GREEN}" "${C_RESET}"
	printf '  %s╰──────────────────────────────────────────────╯%s\n' "${C_GREEN}" "${C_RESET}"
	printf '\n'
	printf '   %sDashboard%s  %s\n' "${C_BOLD}" "${C_RESET}" "${url}"
	printf '   %sImage%s      %s\n' "${C_DIM}" "${C_RESET}" "${image}"
	printf '   %sConfig%s     %s\n' "${C_DIM}" "${C_RESET}" "${NIXPLOY_CONFIG_DIR}"
	printf '   %sLog%s        %s\n' "${C_DIM}" "${C_RESET}" "${LOG_FILE}"
	printf '\n'
	printf '   %sYour data, secrets and certificates were kept.%s\n' "${C_DIM}" "${C_RESET}"
	printf '   %sDB migrations (if any) ran on container start.%s\n' "${C_DIM}" "${C_RESET}"
	printf '   %sRoll back by hand: docker service rollback nixploy%s\n' "${C_DIM}" "${C_RESET}"
	if [ -n "${BACKUP_FILE}" ]; then
		printf '   %sPre-update DB dump: %s (restore + pin the old tag to downgrade)%s\n' "${C_DIM}" "${BACKUP_FILE}" "${C_RESET}"
	fi
	printf '\n'
}

main() {
	if [ "${NIXPLOY_RENDER_TRAEFIK_ONLY:-0}" = "1" ]; then
		render_traefik_static "${NIXPLOY_LETSENCRYPT_EMAIL:-${ACME_EMAIL_UNSET}}"
		exit 0
	fi

	banner
	require_root
	: > "${LOG_FILE}" 2>/dev/null || LOG_FILE="/tmp/nixploy-update.log"

	step "Preflight"
	require_install

	step "App image"
	pull_app_image

	step "Database backup"
	backup_database

	step "Config"
	refresh_traefik_yml

	step "Network segmentation"
	migrate_internal_network

	step "Roll services"
	update_postgres_spec
	update_app
	update_traefik

	step "Health check"
	wait_for_app
	prune_images
	print_summary
}

main "$@"
