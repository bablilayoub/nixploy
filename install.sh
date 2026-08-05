#!/usr/bin/env bash
#
# Nixploy installer.
#
#   curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/install.sh | sudo bash
#
# With a domain (recommended — real HTTPS via Let's Encrypt):
#
#   NIXPLOY_DOMAIN=nixploy.example.com NIXPLOY_LETSENCRYPT_EMAIL=you@example.com \
#     curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/install.sh | sudo bash
#
# Environment overrides:
#   NIXPLOY_DOMAIN               Dashboard domain (A record → this server)
#   NIXPLOY_LETSENCRYPT_EMAIL    ACME email for certificates
#   NIXPLOY_VERSION              App image tag                  (default: latest)
#   NIXPLOY_IMAGE                Full image ref (overrides tag)
#   NIXPLOY_PORT                 Host port for direct app access (default: 3000)
#   NIXPLOY_CONFIG_DIR           Host config directory          (default: /etc/nixploy)
#   POSTGRES_VERSION             Postgres image tag             (default: 17-alpine)
#   TRAEFIK_VERSION              Traefik image tag              (default: v3.5.0)
#   NIXPLOY_SKIP_DOCKER_INSTALL  1 = require pre-installed Docker
#   NIXPLOY_BUILD_FROM_SOURCE    1 = always build the image locally
#   NIXPLOY_REPO                 GitHub org/repo                (default: bablilayoub/nixploy)
#   NIXPLOY_BRANCH               Branch for assets/source       (default: main)
#
set -euo pipefail

NIXPLOY_VERSION="${NIXPLOY_VERSION:-latest}"
NIXPLOY_PORT="${NIXPLOY_PORT:-3000}"
NIXPLOY_CONFIG_DIR="${NIXPLOY_CONFIG_DIR:-/etc/nixploy}"
POSTGRES_VERSION="${POSTGRES_VERSION:-17-alpine}"
TRAEFIK_VERSION="${TRAEFIK_VERSION:-v3.5.0}"
NIXPLOY_REPO="${NIXPLOY_REPO:-bablilayoub/nixploy}"
NIXPLOY_BRANCH="${NIXPLOY_BRANCH:-main}"

NETWORK_NAME="nixploy-network"
APP_IMAGE="${NIXPLOY_IMAGE:-ghcr.io/bablilayoub/nixploy:${NIXPLOY_VERSION}}"
POSTGRES_IMAGE="postgres:${POSTGRES_VERSION}"
TRAEFIK_IMAGE="traefik:${TRAEFIK_VERSION}"
ENV_FILE="${NIXPLOY_CONFIG_DIR}/.env"
LOG_FILE="/var/log/nixploy-install.log"

# Normalized dashboard domain ("https://x.com/y" → "x.com"), empty if unset.
DASHBOARD_DOMAIN=""
if [ -n "${NIXPLOY_DOMAIN:-}" ]; then
	DASHBOARD_DOMAIN="${NIXPLOY_DOMAIN#http://}"
	DASHBOARD_DOMAIN="${DASHBOARD_DOMAIN#https://}"
	DASHBOARD_DOMAIN="${DASHBOARD_DOMAIN%%/*}"
	DASHBOARD_DOMAIN="${DASHBOARD_DOMAIN%%:*}"
fi
ACME_EMAIL="${NIXPLOY_LETSENCRYPT_EMAIL:-}"
if [ -z "${ACME_EMAIL}" ] && [ -n "${DASHBOARD_DOMAIN}" ]; then
	ACME_EMAIL="admin@${DASHBOARD_DOMAIN}"
fi

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
TOTAL_STEPS=9

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
	printf '%s\n' "${C_RESET}${C_DIM}  Self-hosted PaaS · Docker Swarm · one-command install${C_RESET}"
	if [ -n "${DASHBOARD_DOMAIN}" ]; then
		printf '%s\n' "${C_DIM}  Domain: ${DASHBOARD_DOMAIN} (Let's Encrypt)${C_RESET}"
	fi
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

# Run a slow command quietly: spinner + log to $LOG_FILE, tail on failure.
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

# ── preflight ────────────────────────────────────────────────────────────────
require_root() {
	[ "$(id -u)" -eq 0 ] || die "Run as root: curl -fsSL <url> | sudo bash"
}

detect_os() {
	OS_ID="unknown"; OS_LIKE=""; OS_VERSION=""
	if [ -f /etc/os-release ]; then
		# shellcheck disable=SC1091
		. /etc/os-release
		OS_ID="${ID:-unknown}"; OS_LIKE="${ID_LIKE:-}"; OS_VERSION="${VERSION_ID:-}"
	fi
	ARCH="$(uname -m)"
	case "${ARCH}" in
		x86_64|amd64|aarch64|arm64) ;;
		*) die "Unsupported architecture: ${ARCH} (need amd64 or arm64)" ;;
	esac
	case "${OS_ID}" in
		ubuntu|debian|raspbian|linuxmint|pop) FAMILY="debian" ;;
		centos|rhel|rocky|almalinux|fedora|amzn) FAMILY="rhel" ;;
		*)
			case " ${OS_LIKE} " in
				*"debian"*|*"ubuntu"*) FAMILY="debian" ;;
				*"rhel"*|*"fedora"*|*"centos"*) FAMILY="rhel" ;;
				*) FAMILY="unknown" ;;
			esac
			;;
	esac
	ok "OS: ${OS_ID} ${OS_VERSION} · arch: ${ARCH}"
}

need_cmd() { command -v "$1" >/dev/null 2>&1; }

ensure_basics() {
	if need_cmd curl && need_cmd openssl && need_cmd git; then
		ok "curl, openssl, git present"
		return
	fi
	case "${FAMILY}" in
		debian)
			export DEBIAN_FRONTEND=noninteractive
			run_quiet "Installing base packages" bash -c \
				"apt-get update -qq && apt-get install -y -qq curl openssl ca-certificates git"
			;;
		rhel)
			if need_cmd dnf; then
				run_quiet "Installing base packages" dnf install -y -q curl openssl ca-certificates git
			else
				run_quiet "Installing base packages" yum install -y -q curl openssl ca-certificates git
			fi
			;;
		*)
			need_cmd curl || die "Install curl, then re-run"
			need_cmd openssl || die "Install openssl, then re-run"
			need_cmd git || die "Install git, then re-run"
			;;
	esac
}

install_docker() {
	if need_cmd docker && docker info >/dev/null 2>&1; then
		ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
		return
	fi
	[ "${NIXPLOY_SKIP_DOCKER_INSTALL:-0}" = "1" ] && die "Docker missing and NIXPLOY_SKIP_DOCKER_INSTALL=1"
	run_quiet "Installing Docker Engine" bash -c "curl -fsSL https://get.docker.com | sh"
	need_cmd docker || die "Docker install failed"
	systemctl enable --now docker 2>/dev/null || service docker start 2>/dev/null || true
	local i
	for i in $(seq 1 30); do
		docker info >/dev/null 2>&1 && break
		sleep 1
	done
	docker info >/dev/null 2>&1 || die "Docker daemon did not start"
	ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
}

init_swarm() {
	local state
	state="$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || true)"
	if [ "${state}" = "active" ]; then
		ok "Swarm active"
	else
		local addr
		addr="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}' || true)"
		addr="${addr:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
		addr="${addr:-127.0.0.1}"
		docker swarm init --advertise-addr "${addr}" >/dev/null
		ok "Swarm initialized (${addr})"
	fi
	if docker network inspect "${NETWORK_NAME}" >/dev/null 2>&1; then
		ok "Network ${NETWORK_NAME}"
	else
		docker network create --driver overlay --attachable "${NETWORK_NAME}" >/dev/null
		ok "Created network ${NETWORK_NAME}"
	fi
}

# ── secrets & config ─────────────────────────────────────────────────────────
random_hex() { openssl rand -hex "$1"; }

detect_public_ip() {
	local ip
	ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}' || true)"
	printf '%s' "${ip:-127.0.0.1}"
}

detect_public_url() {
	if [ -n "${DASHBOARD_DOMAIN}" ]; then
		printf 'https://%s' "${DASHBOARD_DOMAIN}"
	else
		printf 'https://%s' "$(detect_public_ip)"
	fi
}

set_env_var() {
	local name="$1" value="$2" tmp
	tmp="$(mktemp)"
	awk -v k="${name}" -v v="${value}" '
		BEGIN { done=0 }
		$0 ~ "^"k"=" { print k"="v; done=1; next }
		{ print }
		END { if (!done) print k"="v }
	' "${ENV_FILE}" > "${tmp}"
	mv "${tmp}" "${ENV_FILE}"
	chmod 600 "${ENV_FILE}"
}

write_env_file() {
	mkdir -p "${NIXPLOY_CONFIG_DIR}"
	chmod 700 "${NIXPLOY_CONFIG_DIR}"

	local public_url
	public_url="$(detect_public_url)"

	if [ -f "${ENV_FILE}" ]; then
		# shellcheck disable=SC1090
		set -a; . "${ENV_FILE}"; set +a
		if [ "${BETTER_AUTH_URL:-}" != "${public_url}" ]; then
			set_env_var "BETTER_AUTH_URL" "${public_url}"
			# shellcheck disable=SC1090
			set -a; . "${ENV_FILE}"; set +a
			ok "Updated public URL → ${public_url}"
		else
			ok "Keeping existing secrets (${ENV_FILE})"
		fi
		return
	fi

	umask 077
	cat > "${ENV_FILE}" <<EOF
# Generated by Nixploy install.sh — do not commit.
POSTGRES_USER=nixploy
POSTGRES_PASSWORD=$(random_hex 24)
POSTGRES_DB=nixploy
BETTER_AUTH_SECRET=$(random_hex 32)
BETTER_AUTH_URL=${public_url}
ENCRYPTION_KEY=$(random_hex 32)
PORT=3000
NIXPLOY_CONFIG_DIR=/etc/nixploy
EOF
	set_env_var "DATABASE_URL" "postgres://nixploy:$(awk -F= '/^POSTGRES_PASSWORD=/{print $2}' "${ENV_FILE}")@nixploy-postgres:5432/nixploy"
	ok "Generated secrets (${ENV_FILE})"
	# shellcheck disable=SC1090
	set -a; . "${ENV_FILE}"; set +a
}

write_traefik_static() {
	cat > "${NIXPLOY_CONFIG_DIR}/traefik/traefik.yml" <<EOF
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
      email: ${ACME_EMAIL:-nixploy@localhost}
      storage: /etc/nixploy/traefik/acme.json
      httpChallenge:
        entryPoint: web
api:
  dashboard: false
EOF
	ok "Traefik static config (HTTPS redirect on)"
}

write_tls_and_routing() {
	local dyn="${NIXPLOY_CONFIG_DIR}/traefik/dynamic"
	local cert="${dyn}/default.crt" key="${dyn}/default.key"
	local ip
	ip="$(detect_public_ip)"

	if [ ! -f "${cert}" ] || [ ! -f "${key}" ]; then
		local san="DNS:localhost,IP:127.0.0.1,IP:${ip}"
		[ -n "${DASHBOARD_DOMAIN}" ] && san="${san},DNS:${DASHBOARD_DOMAIN}"
		openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
			-keyout "${key}" -out "${cert}" \
			-subj "/CN=nixploy" -addext "subjectAltName=${san}" 2>/dev/null \
			|| openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
				-keyout "${key}" -out "${cert}" -subj "/CN=${ip}"
		chmod 600 "${key}" "${cert}"
		ok "Self-signed fallback certificate"
	else
		ok "Keeping existing fallback certificate"
	fi

	cat > "${dyn}/00-default-tls.yml" <<EOF
tls:
  stores:
    default:
      defaultCertificate:
        certFile: /etc/nixploy/traefik/dynamic/default.crt
        keyFile: /etc/nixploy/traefik/dynamic/default.key
EOF

	local domain_router=""
	if [ -n "${DASHBOARD_DOMAIN}" ]; then
		domain_router="    nixploy-dashboard-domain:
      rule: Host(\`${DASHBOARD_DOMAIN}\`)
      entryPoints:
        - websecure
      service: nixploy-dashboard
      tls:
        certResolver: letsencrypt
"
	fi
	cat > "${dyn}/00-nixploy-dashboard.yml" <<EOF
http:
  routers:
    nixploy-dashboard:
      rule: PathPrefix(\`/\`)
      entryPoints:
        - websecure
      service: nixploy-dashboard
      tls: {}
      priority: 1
${domain_router}  services:
    nixploy-dashboard:
      loadBalancer:
        servers:
          - url: http://nixploy:3000
EOF
	if [ -n "${DASHBOARD_DOMAIN}" ]; then
		ok "Dashboard routing: https://${DASHBOARD_DOMAIN} (Let's Encrypt) + https://${ip} (fallback)"
	else
		ok "Dashboard routing: https://${ip} (self-signed)"
	fi
}

ensure_directories() {
	mkdir -p \
		"${NIXPLOY_CONFIG_DIR}/traefik/dynamic" \
		"${NIXPLOY_CONFIG_DIR}/applications" \
		"${NIXPLOY_CONFIG_DIR}/compose" \
		"${NIXPLOY_CONFIG_DIR}/logs"
	touch "${NIXPLOY_CONFIG_DIR}/traefik/acme.json"
	chmod 600 "${NIXPLOY_CONFIG_DIR}/traefik/acme.json"
	write_traefik_static
	write_tls_and_routing
}

# ── images ───────────────────────────────────────────────────────────────────
build_app_image() {
	local tmp
	tmp="$(mktemp -d)"
	info "Building from source — this takes several minutes (~4GB RAM needed)"
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

ensure_app_image() {
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

pull_images() {
	ensure_app_image
	run_quiet "Pulling Postgres ${POSTGRES_VERSION}" docker pull "${POSTGRES_IMAGE}" || die "Postgres pull failed"
	run_quiet "Pulling Traefik ${TRAEFIK_VERSION}" docker pull "${TRAEFIK_IMAGE}" || die "Traefik pull failed"
}

# ── services ─────────────────────────────────────────────────────────────────
create_postgres() {
	if docker service inspect nixploy-postgres >/dev/null 2>&1; then
		ok "Service nixploy-postgres (existing)"
		return
	fi
	docker service create \
		--name nixploy-postgres \
		--network "${NETWORK_NAME}" \
		--constraint 'node.role == manager' \
		--replicas 1 \
		--detach \
		--env-file "${ENV_FILE}" \
		--env POSTGRES_USER --env POSTGRES_PASSWORD --env POSTGRES_DB \
		--mount type=volume,source=nixploy-postgres-data,target=/var/lib/postgresql/data \
		"${POSTGRES_IMAGE}" >/dev/null
	ok "Created nixploy-postgres"
}

wait_for_postgres() {
	local i
	for i in $(seq 1 60); do
		if docker run --rm --network "${NETWORK_NAME}" "${POSTGRES_IMAGE}" \
			pg_isready -h nixploy-postgres -U "${POSTGRES_USER:-nixploy}" -d "${POSTGRES_DB:-nixploy}" >/dev/null 2>&1; then
			ok "Postgres ready"
			return
		fi
		sleep 2
	done
	die "Postgres not ready — check: docker service logs nixploy-postgres"
}

create_traefik() {
	if docker service inspect nixploy-traefik >/dev/null 2>&1; then
		local mounts
		mounts="$(docker service inspect nixploy-traefik --format '{{range .Spec.TaskTemplate.ContainerSpec.Mounts}}{{.Target}} {{end}}' 2>/dev/null || true)"
		case " ${mounts} " in
			*" /etc/nixploy/traefik/dynamic "*)
				ok "Service nixploy-traefik (existing)"
				return
				;;
			*)
				docker service rm nixploy-traefik >/dev/null
				sleep 2
				;;
		esac
	fi
	docker service create \
		--name nixploy-traefik \
		--network "${NETWORK_NAME}" \
		--mode global \
		--constraint 'node.role == manager' \
		--detach \
		--publish mode=host,target=80,published=80 \
		--publish mode=host,target=443,published=443 \
		--mount type=bind,source="${NIXPLOY_CONFIG_DIR}/traefik/traefik.yml",target=/etc/traefik/traefik.yml,readonly \
		--mount type=bind,source="${NIXPLOY_CONFIG_DIR}/traefik/dynamic",target=/etc/nixploy/traefik/dynamic \
		--mount type=bind,source="${NIXPLOY_CONFIG_DIR}/traefik/acme.json",target=/etc/nixploy/traefik/acme.json \
		"${TRAEFIK_IMAGE}" >/dev/null
	ok "Created nixploy-traefik (:80 → :443)"
}

create_app() {
	if docker service inspect nixploy >/dev/null 2>&1; then
		# stop-first: port 3000 is host-published, a second task can never bind
		# it while the old one runs (start-first deadlocks the update).
		docker service update \
			--detach --force --no-resolve-image \
			--update-order stop-first \
			--image "${APP_IMAGE}" \
			--env-add "BETTER_AUTH_URL=${BETTER_AUTH_URL}" \
			nixploy >/dev/null
		ok "Updated nixploy → ${APP_IMAGE}"
		return
	fi
	docker service create \
		--name nixploy \
		--network "${NETWORK_NAME}" \
		--constraint 'node.role == manager' \
		--replicas 1 \
		--detach \
		--no-resolve-image \
		--publish "mode=host,target=3000,published=${NIXPLOY_PORT}" \
		--env-file "${ENV_FILE}" \
		--env DATABASE_URL --env BETTER_AUTH_SECRET --env BETTER_AUTH_URL \
		--env ENCRYPTION_KEY \
		--env PORT=3000 \
		--env NIXPLOY_CONFIG_DIR=/etc/nixploy \
		--env NIXPLOY_DISABLE_TRAEFIK_BOOT=1 \
		--mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
		--mount type=bind,source="${NIXPLOY_CONFIG_DIR}",target=/etc/nixploy \
		--update-order stop-first \
		"${APP_IMAGE}" >/dev/null
	ok "Created nixploy"
}

wait_for_app() {
	local url
	url="${BETTER_AUTH_URL:-$(detect_public_url)}"
	local i code
	if [ "${IS_TTY}" = "1" ]; then
		local frames='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
		for i in $(seq 1 90); do
			code="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 2 \
				"http://127.0.0.1:${NIXPLOY_PORT}/setup" 2>/dev/null || true)"
			case "${code}" in
				200|302|307|308) printf '\r\033[K'; ok "App is up"; break ;;
			esac
			printf '\r   %s%s%s Waiting for the app to start (%d/90)' \
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
		die "Startup failed — debug with: docker service logs -f nixploy"
	fi
	code="$(curl -sk -o /dev/null -w '%{http_code}' --connect-timeout 3 "${url}/setup" 2>/dev/null || true)"
	case "${code}" in
		200|302|307|308) ok "HTTPS ready at ${url}" ;;
		*) warn "Traefik still settling for ${url} — give it a few seconds" ;;
	esac
}

print_summary() {
	local url
	url="${BETTER_AUTH_URL:-$(detect_public_url)}"
	printf '\n'
	printf '  %s╭──────────────────────────────────────────────╮%s\n' "${C_GREEN}" "${C_RESET}"
	printf '  %s│%s        %s🚀 Nixploy is installed%s               %s│%s\n' "${C_GREEN}" "${C_RESET}" "${C_BOLD}" "${C_RESET}" "${C_GREEN}" "${C_RESET}"
	printf '  %s╰──────────────────────────────────────────────╯%s\n' "${C_GREEN}" "${C_RESET}"
	printf '\n'
	printf '   %sCreate your admin account:%s\n' "${C_BOLD}" "${C_RESET}"
	printf '   %s→%s  %s%s/setup%s\n' "${C_GREEN}" "${C_RESET}" "${C_BOLD}${C_CYAN}" "${url}" "${C_RESET}"
	printf '\n'
	if [ -n "${DASHBOARD_DOMAIN}" ]; then
		printf '   %sThe Let'"'"'s Encrypt certificate is issued on first visit.%s\n' "${C_DIM}" "${C_RESET}"
		printf '   %sMake sure the DNS A record of %s points here.%s\n' "${C_DIM}" "${DASHBOARD_DOMAIN}" "${C_RESET}"
	else
		printf '   %sThe certificate is self-signed — accept the browser warning once.%s\n' "${C_DIM}" "${C_RESET}"
		printf '   %sAdd a real domain later in Settings → Server → Dashboard domain.%s\n' "${C_DIM}" "${C_RESET}"
	fi
	printf '\n'
	printf '   %sConfig%s   %s\n' "${C_DIM}" "${C_RESET}" "${NIXPLOY_CONFIG_DIR}"
	printf '   %sLogs%s     docker service logs -f nixploy\n' "${C_DIM}" "${C_RESET}"
	printf '   %sUpdate%s   curl -fsSL …/update.sh | sudo bash\n' "${C_DIM}" "${C_RESET}"
	printf '\n'
}

main() {
	banner
	require_root
	: > "${LOG_FILE}" 2>/dev/null || LOG_FILE="/tmp/nixploy-install.log"

	step "Operating system"
	detect_os

	step "Prerequisites"
	ensure_basics

	step "Docker Engine"
	install_docker

	step "Docker Swarm"
	init_swarm

	step "Config & secrets"
	write_env_file
	ensure_directories

	step "Container images"
	pull_images

	step "Database"
	create_postgres
	wait_for_postgres

	step "Traefik & Nixploy"
	create_traefik
	create_app

	step "Health check"
	wait_for_app
	print_summary
}

main "$@"
