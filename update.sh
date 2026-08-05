#!/usr/bin/env bash
#
# Nixploy updater — pull the latest image and roll the Swarm services.
#
#   curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/update.sh | sudo bash
#
# Safe: keeps /etc/nixploy/.env, Postgres data, Traefik ACME certs and
# dynamic routes. Migrations run automatically when the new container starts.
#
# Environment overrides:
#   NIXPLOY_VERSION              App image tag                 (default: latest)
#   NIXPLOY_IMAGE                Full image ref (overrides tag)
#   NIXPLOY_CONFIG_DIR           Host config directory         (default: /etc/nixploy)
#   NIXPLOY_PORT                 Published app port            (default: 3000)
#   TRAEFIK_VERSION              Traefik image tag             (default: v3.5.0)
#   NIXPLOY_UPDATE_TRAEFIK        1 = also pull & force Traefik  (default: 1)
#   NIXPLOY_REFRESH_TRAEFIK_YML  1 = rewrite static traefik.yml (default: 1)
#   NIXPLOY_PRUNE                1 = prune dangling images     (default: 1)
#   NIXPLOY_BUILD_FROM_SOURCE    1 = build locally instead of pull
#   NIXPLOY_REPO                 GitHub org/repo               (default: bablilayoub/nixploy)
#   NIXPLOY_BRANCH               Branch for assets/source      (default: main)
#
set -euo pipefail

NIXPLOY_VERSION="${NIXPLOY_VERSION:-latest}"
NIXPLOY_PORT="${NIXPLOY_PORT:-3000}"
NIXPLOY_CONFIG_DIR="${NIXPLOY_CONFIG_DIR:-/etc/nixploy}"
TRAEFIK_VERSION="${TRAEFIK_VERSION:-v3.5.0}"
NIXPLOY_REPO="${NIXPLOY_REPO:-bablilayoub/nixploy}"
NIXPLOY_BRANCH="${NIXPLOY_BRANCH:-main}"
NIXPLOY_UPDATE_TRAEFIK="${NIXPLOY_UPDATE_TRAEFIK:-1}"
NIXPLOY_REFRESH_TRAEFIK_YML="${NIXPLOY_REFRESH_TRAEFIK_YML:-1}"
NIXPLOY_PRUNE="${NIXPLOY_PRUNE:-1}"

APP_IMAGE="${NIXPLOY_IMAGE:-ghcr.io/bablilayoub/nixploy:${NIXPLOY_VERSION}}"
TRAEFIK_IMAGE="traefik:${TRAEFIK_VERSION}"
ENV_FILE="${NIXPLOY_CONFIG_DIR}/.env"
LOG_FILE="/var/log/nixploy-update.log"

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
	# shellcheck disable=SC1090
	set -a; . "${ENV_FILE}"; set +a

	local current
	current="$(docker service inspect nixploy --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' 2>/dev/null || true)"
	ok "Current image: ${current:-unknown}"
	ok "Target image:  ${APP_IMAGE}"
}

# ── image ────────────────────────────────────────────────────────────────────
build_app_image() {
	need_cmd git || die "git is required to build from source"
	local tmp
	tmp="$(mktemp -d)"
	info "Building from source — this takes several minutes"
	if ! run_quiet "Cloning ${NIXPLOY_REPO}@${NIXPLOY_BRANCH}" \
		git clone --depth 1 --branch "${NIXPLOY_BRANCH}" "https://github.com/${NIXPLOY_REPO}.git" "${tmp}/src"; then
		rm -rf "${tmp}"
		die "Clone failed"
	fi
	if ! run_quiet "Building ${APP_IMAGE}" \
		docker build -t "${APP_IMAGE}" -f "${tmp}/src/docker/Dockerfile" "${tmp}/src"; then
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
	warn "Pull failed — building from source instead"
	build_app_image
}

# ── config ───────────────────────────────────────────────────────────────────
refresh_traefik_yml() {
	[ "${NIXPLOY_REFRESH_TRAEFIK_YML}" = "1" ] || {
		ok "Keeping existing traefik.yml"
		return
	}
	mkdir -p "${NIXPLOY_CONFIG_DIR}/traefik/dynamic"
	local email="${NIXPLOY_LETSENCRYPT_EMAIL:-}"
	if [ -z "${email}" ]; then
		# Prefer the ACME email already in the static config, else a safe default.
		email="$(awk -F': *' '/^[[:space:]]*email:/{print $2; exit}' \
			"${NIXPLOY_CONFIG_DIR}/traefik/traefik.yml" 2>/dev/null || true)"
		email="${email:-nixploy@localhost}"
	fi
	# Preserve existing ACME email when rewriting.
	local url="https://raw.githubusercontent.com/${NIXPLOY_REPO}/${NIXPLOY_BRANCH}/docker/traefik/traefik.yml"
	local tmp
	tmp="$(mktemp)"
	if curl -fsSL "${url}" -o "${tmp}" 2>>"${LOG_FILE}"; then
		# Inject the saved ACME email so we don't wipe the Let's Encrypt account.
		awk -v email="${email}" '
			/^[[:space:]]*email:/ { sub(/email:.*/, "email: " email); print; next }
			{ print }
		' "${tmp}" > "${NIXPLOY_CONFIG_DIR}/traefik/traefik.yml"
		rm -f "${tmp}"
		ok "Refreshed traefik.yml (ACME email: ${email})"
	else
		rm -f "${tmp}"
		warn "Could not fetch traefik.yml — keeping the existing file"
	fi
}

# ── roll services ────────────────────────────────────────────────────────────
update_app() {
	# --no-resolve-image: use the local tag after a source build; otherwise
	# Swarm can hang trying to re-resolve against GHCR.
	# --force: recreate even when the image tag string is unchanged (e.g. :latest).
	# --update-order start-first: bring the new task up before killing the old one.
	docker service update \
		--detach \
		--force \
		--no-resolve-image \
		--image "${APP_IMAGE}" \
		--update-order start-first \
		--env-add "BETTER_AUTH_URL=${BETTER_AUTH_URL:-}" \
		--env-add "NIXPLOY_DISABLE_TRAEFIK_BOOT=1" \
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
		nixploy-traefik >/dev/null
	ok "Rolling nixploy-traefik → ${TRAEFIK_IMAGE}"
}

wait_for_app() {
	local url="${BETTER_AUTH_URL:-}"
	if [ -z "${url}" ]; then
		local ip
		ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}' || true)"
		url="https://${ip:-127.0.0.1}"
	fi

	local i code=""
	if [ "${IS_TTY}" = "1" ]; then
		local frames='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
		for i in $(seq 1 90); do
			code="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 2 \
				"http://127.0.0.1:${NIXPLOY_PORT}/api/auth/ok" 2>/dev/null || true)"
			# /api/auth/ok may 404 on older builds — any response from the app is fine.
			case "${code}" in
				200|204|301|302|307|308|404) printf '\r\033[K'; ok "App is up"; break ;;
			esac
			code="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 2 \
				"http://127.0.0.1:${NIXPLOY_PORT}/setup" 2>/dev/null || true)"
			case "${code}" in
				200|302|307|308) printf '\r\033[K'; ok "App is up"; break ;;
			esac
			printf '\r   %s%s%s Waiting for the new container (%d/90)' \
				"${C_CYAN}" "${frames:i%10:1}" "${C_RESET}" "$i"
			sleep 2
			code=""
		done
		[ -n "${code}" ] || printf '\r\033[K'
	else
		for i in $(seq 1 90); do
			code="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 2 \
				"http://127.0.0.1:${NIXPLOY_PORT}/setup" 2>/dev/null || true)"
			case "${code}" in
				200|302|307|308) ok "App is up"; break ;;
			esac
			sleep 2
			code=""
		done
	fi

	if [ -z "${code}" ]; then
		warn "App not responding after ~3 minutes"
		docker service ps nixploy --no-trunc 2>/dev/null | head -n 5 >&2 || true
		docker service logs --tail 50 nixploy >&2 2>/dev/null || true
		die "Update failed — debug with: docker service logs -f nixploy"
	fi

	code="$(curl -sk -o /dev/null -w '%{http_code}' --connect-timeout 3 "${url}/setup" 2>/dev/null || true)"
	case "${code}" in
		200|302|307|308) ok "HTTPS ready at ${url}" ;;
		*) warn "Traefik still settling for ${url} — give it a few seconds" ;;
	esac
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
	printf '\n'
}

main() {
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
