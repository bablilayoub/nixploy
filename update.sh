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
#   NIXPLOY_NETWORK              Forwarded to the app when set (custom overlay network)
#   NIXPLOY_LETSENCRYPT_EMAIL    Replace the ACME email in traefik.yml (default: keep)
#   TRAEFIK_VERSION              Traefik image tag             (default: v3.5.0)
#   NIXPLOY_UPDATE_TRAEFIK       1 = also pull & force Traefik  (default: 1)
#   NIXPLOY_REFRESH_TRAEFIK_YML  1 = re-render static traefik.yml, keeping the ACME email (default: 1)
#   NIXPLOY_PRUNE                1 = prune dangling images     (default: 1)
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
TOTAL_STEPS=5

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
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
          permanent: true
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
	# Rendered locally (no network): fixes drift from older templates that
	# enabled INFO logging + accessLog on the unrotated json-file driver.
	render_traefik_static "${email}" > "${file}"
	if [ "${email}" = "${ACME_EMAIL_UNSET}" ]; then
		ok "Refreshed traefik.yml (no ACME email)"
		warn "Let's Encrypt is unavailable until an email is set: NIXPLOY_LETSENCRYPT_EMAIL=… update.sh, or Settings → Platform → Let's Encrypt email."
	else
		ok "Refreshed traefik.yml (ACME email: ${email})"
	fi
}

# ── roll services ────────────────────────────────────────────────────────────
LOG_ARGS=(--log-driver json-file --log-opt max-size=10m --log-opt max-file=3)
ROLL_ARGS=(
	--update-order stop-first
	--update-failure-action rollback
	--update-monitor 60s
	--rollback-order stop-first
)

# Env forwarded to the app: documented knobs, only when set (values already on
# the service are kept — `--env-add` never removes anything).
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
	for name in LOG_LEVEL LOG_FORMAT DATABASE_POOL_MAX NIXPLOY_NETWORK; do
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
		"${LOG_ARGS[@]}" \
		"${APP_ENV_ARGS[@]}" \
		nixploy >/dev/null
	ok "Rolling nixploy → ${APP_IMAGE}"
}

update_traefik() {
	[ "${NIXPLOY_UPDATE_TRAEFIK}" = "1" ] || {
		ok "Skipping Traefik update"
		return
	}
	run_quiet "Pulling ${TRAEFIK_IMAGE}" docker pull "${TRAEFIK_IMAGE}" || {
		warn "Traefik pull failed — leaving current Traefik running"
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
# propagated and does not need :3000 published. Prints the HTTP status.
probe_via_traefik() {
	curl -sk -o /dev/null -w '%{http_code}' --connect-timeout 2 --max-time 8 \
		--resolve "${1}:443:127.0.0.1" "https://${1}/setup" 2>/dev/null || true
}

probe_via_port() {
	curl -s -o /dev/null -w '%{http_code}' --connect-timeout 2 --max-time 8 \
		"http://127.0.0.1:${1}/setup" 2>/dev/null || true
}

# /setup answers 200 (first boot) or a redirect to /login once an owner exists.
is_ready_code() {
	case "${1:-}" in 200|302|307|308) return 0 ;; esac
	return 1
}

app_is_ready() {
	local host="$1" port="${2:-}"
	is_ready_code "$(probe_via_traefik "${host}")" && return 0
	[ -n "${port}" ] && is_ready_code "$(probe_via_port "${port}")" && return 0
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

	step "Config"
	refresh_traefik_yml

	step "Roll services"
	update_app
	update_traefik

	step "Health check"
	wait_for_app
	prune_images
	print_summary
}

main "$@"
