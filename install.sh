#!/usr/bin/env bash
#
# Nixploy installer — one script to provision a self-hosted instance.
#
#   curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/install.sh | sudo bash
#
# Idempotent. Detects OS, installs Docker if missing, initializes Swarm,
# writes secrets, starts postgres + traefik + nixploy, waits until healthy,
# then prints the setup URL for the first admin account.
#
# Environment overrides:
#   NIXPLOY_VERSION              App image tag                 (default: latest)
#   NIXPLOY_IMAGE                Full image ref (overrides tag) (default: ghcr.io/bablilayoub/nixploy:$NIXPLOY_VERSION)
#   NIXPLOY_PORT                 Host port for the dashboard   (default: 3000)
#   NIXPLOY_CONFIG_DIR           Host config directory         (default: /etc/nixploy)
#   NIXPLOY_DOMAIN               Public URL host (optional)    → BETTER_AUTH_URL
#   POSTGRES_VERSION             Postgres image tag            (default: 17-alpine)
#   TRAEFIK_VERSION              Traefik image tag             (default: v3.5.0)
#   NIXPLOY_SKIP_DOCKER_INSTALL  Set to 1 to skip Docker install
#   NIXPLOY_BUILD_FROM_SOURCE    Set to 1 to skip pull and build locally
#   NIXPLOY_REPO                 GitHub org/repo for assets    (default: bablilayoub/nixploy)
#   NIXPLOY_BRANCH               Branch for raw assets         (default: main)
#
set -euo pipefail

# ── defaults ────────────────────────────────────────────────────────────────
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

# ── modern CLI theme ────────────────────────────────────────────────────────
if [ -t 1 ] && [ "${NO_COLOR:-}" = "" ]; then
	C_RESET=$'\033[0m'
	C_BOLD=$'\033[1m'
	C_DIM=$'\033[2m'
	C_CYAN=$'\033[36m'
	C_GREEN=$'\033[32m'
	C_YELLOW=$'\033[33m'
	C_RED=$'\033[31m'
	C_BLUE=$'\033[34m'
else
	C_RESET=""; C_BOLD=""; C_DIM=""; C_CYAN=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_BLUE=""
fi

STEP=0
TOTAL_STEPS=9

banner() {
	printf '\n'
	printf '%s' "${C_CYAN}${C_BOLD}"
	cat <<'EOF'
    _   ___            __           
   / | / (_)  ______  / /___  __  __
  /  |/ / / |/_/ __ \/ / __ \/ / / /
 / /|  / />  </ /_/ / / /_/ / /_/ / 
/_/ |_/_/_/|_/ .___/_/\____/\__, /  
            /_/            /____/   
EOF
	printf '%s\n' "${C_RESET}${C_DIM}  Self-hosted PaaS · Docker Swarm · one-command install${C_RESET}"
	printf '\n'
}

step() {
	STEP=$((STEP + 1))
	printf '\n%s[%d/%d]%s %s%s%s\n' "${C_BLUE}${C_BOLD}" "$STEP" "$TOTAL_STEPS" "${C_RESET}" "${C_BOLD}" "$*" "${C_RESET}"
}

ok()   { printf '  %s✓%s %s\n' "${C_GREEN}" "${C_RESET}" "$*"; }
info() { printf '  %s•%s %s\n' "${C_CYAN}" "${C_RESET}" "$*"; }
warn() { printf '  %s!%s %s\n' "${C_YELLOW}" "${C_RESET}" "$*" >&2; }
die()  { printf '\n  %s✗ ERROR:%s %s\n\n' "${C_RED}${C_BOLD}" "${C_RESET}" "$*" >&2; exit 1; }

# ── preflight ───────────────────────────────────────────────────────────────
require_root() {
	if [ "$(id -u)" -ne 0 ]; then
		die "Run as root: curl -fsSL <url> | sudo bash"
	fi
}

detect_os() {
	OS_ID="unknown"
	OS_LIKE=""
	OS_VERSION=""
	if [ -f /etc/os-release ]; then
		# shellcheck disable=SC1091
		. /etc/os-release
		OS_ID="${ID:-unknown}"
		OS_LIKE="${ID_LIKE:-}"
		OS_VERSION="${VERSION_ID:-}"
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
	info "OS: ${OS_ID} ${OS_VERSION} (${FAMILY}) · arch: ${ARCH}"
}

need_cmd() {
	command -v "$1" >/dev/null 2>&1
}

ensure_basics() {
	local missing=()
	need_cmd curl || missing+=(curl)
	need_cmd openssl || missing+=(openssl)
	need_cmd git || missing+=(git)
	if [ "${#missing[@]}" -eq 0 ]; then
		ok "curl, openssl, git present"
		return
	fi
	info "Installing base packages: ${missing[*]} ca-certificates"
	case "${FAMILY}" in
		debian)
			export DEBIAN_FRONTEND=noninteractive
			apt-get update -qq
			apt-get install -y -qq curl openssl ca-certificates git >/dev/null
			;;
		rhel)
			if need_cmd dnf; then
				dnf install -y -q curl openssl ca-certificates git >/dev/null
			else
				yum install -y -q curl openssl ca-certificates git >/dev/null
			fi
			;;
		*)
			need_cmd curl || die "Install curl, then re-run"
			need_cmd openssl || die "Install openssl, then re-run"
			need_cmd git || die "Install git, then re-run"
			;;
	esac
	ok "Base packages ready"
}

install_docker() {
	if need_cmd docker && docker info >/dev/null 2>&1; then
		ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
		return
	fi
	if [ "${NIXPLOY_SKIP_DOCKER_INSTALL:-0}" = "1" ]; then
		die "Docker missing and NIXPLOY_SKIP_DOCKER_INSTALL=1"
	fi
	info "Installing Docker Engine via get.docker.com…"
	curl -fsSL https://get.docker.com | sh
	need_cmd docker || die "Docker install failed"
	systemctl enable --now docker 2>/dev/null || service docker start 2>/dev/null || true
	# Give the daemon a moment on fresh installs.
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
		ok "Swarm already active"
		return
	fi
	local advertise_addr
	advertise_addr="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}' || true)"
	if [ -z "${advertise_addr}" ]; then
		advertise_addr="$(hostname -I 2>/dev/null | awk '{print $1}')"
	fi
	advertise_addr="${advertise_addr:-127.0.0.1}"
	info "Initializing Swarm (advertise-addr: ${advertise_addr})"
	docker swarm init --advertise-addr "${advertise_addr}" >/dev/null
	ok "Swarm ready"
}

ensure_network() {
	if docker network inspect "${NETWORK_NAME}" >/dev/null 2>&1; then
		ok "Network ${NETWORK_NAME}"
	else
		docker network create --driver overlay --attachable "${NETWORK_NAME}" >/dev/null
		ok "Created network ${NETWORK_NAME}"
	fi
}

# ── secrets & dirs ──────────────────────────────────────────────────────────
random_hex() { openssl rand -hex "$1"; }

detect_public_url() {
	if [ -n "${NIXPLOY_DOMAIN:-}" ]; then
		case "${NIXPLOY_DOMAIN}" in
			http://*|https://*) printf '%s' "${NIXPLOY_DOMAIN}" ;;
			*) printf 'https://%s' "${NIXPLOY_DOMAIN}" ;;
		esac
		return
	fi
	local ip
	ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}' || true)"
	ip="${ip:-127.0.0.1}"
	if [ "${NIXPLOY_PORT}" = "80" ]; then
		printf 'http://%s' "${ip}"
	else
		printf 'http://%s:%s' "${ip}" "${NIXPLOY_PORT}"
	fi
}

write_env_file() {
	mkdir -p "${NIXPLOY_CONFIG_DIR}"
	chmod 700 "${NIXPLOY_CONFIG_DIR}"

	if [ -f "${ENV_FILE}" ]; then
		ok "Keeping existing ${ENV_FILE}"
		# shellcheck disable=SC1090
		set -a; . "${ENV_FILE}"; set +a
		return
	fi

	local auth_secret enc_key pg_pass public_url
	auth_secret="$(random_hex 32)"
	enc_key="$(random_hex 32)"
	pg_pass="$(random_hex 24)"
	public_url="$(detect_public_url)"

	umask 077
	cat > "${ENV_FILE}" <<EOF
# Generated by Nixploy install.sh — do not commit.
# $(date -u +%Y-%m-%dT%H:%M:%SZ)

POSTGRES_USER=nixploy
POSTGRES_PASSWORD=${pg_pass}
POSTGRES_DB=nixploy
DATABASE_URL=postgres://nixploy:${pg_pass}@nixploy-postgres:5432/nixploy

BETTER_AUTH_SECRET=${auth_secret}
BETTER_AUTH_URL=${public_url}
ENCRYPTION_KEY=${enc_key}
NEXT_PUBLIC_APP_URL=${public_url}
PORT=3000
NIXPLOY_CONFIG_DIR=/etc/nixploy
EOF
	chmod 600 "${ENV_FILE}"
	ok "Wrote secrets to ${ENV_FILE}"
	# shellcheck disable=SC1090
	set -a; . "${ENV_FILE}"; set +a
}

ensure_directories() {
	mkdir -p \
		"${NIXPLOY_CONFIG_DIR}/traefik/dynamic" \
		"${NIXPLOY_CONFIG_DIR}/applications" \
		"${NIXPLOY_CONFIG_DIR}/compose" \
		"${NIXPLOY_CONFIG_DIR}/logs"

	if [ ! -f "${NIXPLOY_CONFIG_DIR}/traefik/traefik.yml" ]; then
		local url="https://raw.githubusercontent.com/${NIXPLOY_REPO}/${NIXPLOY_BRANCH}/docker/traefik/traefik.yml"
		if curl -fsSL "${url}" -o "${NIXPLOY_CONFIG_DIR}/traefik/traefik.yml"; then
			ok "Fetched traefik.yml"
		else
			warn "Could not fetch traefik.yml — writing embedded fallback"
			cat > "${NIXPLOY_CONFIG_DIR}/traefik/traefik.yml" <<'YAML'
global:
  checkNewVersion: false
  sendAnonymousUsage: false
entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"
    http:
      tls:
        certResolver: letsencrypt
providers:
  file:
    directory: /etc/traefik/dynamic
    watch: true
certificatesResolvers:
  letsencrypt:
    acme:
      email: nixploy@localhost
      storage: /etc/traefik/dynamic/acme.json
      httpChallenge:
        entryPoint: web
api:
  insecure: false
YAML
		fi
	else
		ok "Keeping existing traefik.yml"
	fi

	if [ ! -f "${NIXPLOY_CONFIG_DIR}/traefik/dynamic/acme.json" ]; then
		touch "${NIXPLOY_CONFIG_DIR}/traefik/dynamic/acme.json"
	fi
	chmod 600 "${NIXPLOY_CONFIG_DIR}/traefik/dynamic/acme.json"
	ok "Config dirs under ${NIXPLOY_CONFIG_DIR}"
}

# ── services ────────────────────────────────────────────────────────────────
build_app_image() {
	local tmp
	tmp="$(mktemp -d)"
	info "Building ${APP_IMAGE} from https://github.com/${NIXPLOY_REPO} (${NIXPLOY_BRANCH})…"
	info "This can take several minutes and needs ~4GB RAM"
	if ! git clone --depth 1 --branch "${NIXPLOY_BRANCH}" \
		"https://github.com/${NIXPLOY_REPO}.git" "${tmp}/src" >/dev/null; then
		rm -rf "${tmp}"
		die "Failed to clone ${NIXPLOY_REPO}@${NIXPLOY_BRANCH}"
	fi
	if ! docker build \
		-t "${APP_IMAGE}" \
		-f "${tmp}/src/docker/Dockerfile" \
		"${tmp}/src"; then
		rm -rf "${tmp}"
		die "Docker build failed — check free disk/RAM, or wait for ghcr.io/${NIXPLOY_REPO}:${NIXPLOY_VERSION}"
	fi
	rm -rf "${tmp}"
	ok "Built ${APP_IMAGE}"
}

ensure_app_image() {
	if [ "${NIXPLOY_BUILD_FROM_SOURCE:-0}" = "1" ]; then
		build_app_image
		return
	fi
	info "Pulling ${APP_IMAGE}"
	if docker pull "${APP_IMAGE}"; then
		ok "App image"
		return
	fi
	warn "Could not pull ${APP_IMAGE} (image may not be published yet)"
	warn "Falling back to a local build from source"
	build_app_image
}

pull_images() {
	ensure_app_image
	docker pull "${POSTGRES_IMAGE}" >/dev/null
	ok "Postgres ${POSTGRES_VERSION}"
	docker pull "${TRAEFIK_IMAGE}" >/dev/null
	ok "Traefik ${TRAEFIK_VERSION}"
}

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
		--env-file "${ENV_FILE}" \
		--env POSTGRES_USER \
		--env POSTGRES_PASSWORD \
		--env POSTGRES_DB \
		--mount type=volume,source=nixploy-postgres-data,target=/var/lib/postgresql/data \
		"${POSTGRES_IMAGE}" >/dev/null
	ok "Created nixploy-postgres"
}

wait_for_postgres() {
	info "Waiting for Postgres…"
	local i
	for i in $(seq 1 60); do
		if docker run --rm --network "${NETWORK_NAME}" "${POSTGRES_IMAGE}" \
			pg_isready -h nixploy-postgres -U "${POSTGRES_USER:-nixploy}" -d "${POSTGRES_DB:-nixploy}" >/dev/null 2>&1; then
			ok "Postgres accepting connections"
			return
		fi
		sleep 2
	done
	die "Postgres did not become ready in time — check: docker service logs nixploy-postgres"
}

create_traefik() {
	if docker service inspect nixploy-traefik >/dev/null 2>&1; then
		ok "Service nixploy-traefik (existing)"
		return
	fi
	docker service create \
		--name nixploy-traefik \
		--network "${NETWORK_NAME}" \
		--mode global \
		--constraint 'node.role == manager' \
		--publish mode=host,target=80,published=80 \
		--publish mode=host,target=443,published=443 \
		--mount type=bind,source="${NIXPLOY_CONFIG_DIR}/traefik/traefik.yml",target=/etc/traefik/traefik.yml,readonly \
		--mount type=bind,source="${NIXPLOY_CONFIG_DIR}/traefik/dynamic",target=/etc/traefik/dynamic \
		"${TRAEFIK_IMAGE}" >/dev/null
	ok "Created nixploy-traefik (80/443)"
}

create_app() {
	local env_args=(
		--env-file "${ENV_FILE}"
		--env DATABASE_URL
		--env BETTER_AUTH_SECRET
		--env BETTER_AUTH_URL
		--env ENCRYPTION_KEY
		--env NEXT_PUBLIC_APP_URL
		--env PORT=3000
		--env NIXPLOY_CONFIG_DIR=/etc/nixploy
		--env NIXPLOY_DISABLE_TRAEFIK_BOOT=1
	)

	if docker service inspect nixploy >/dev/null 2>&1; then
		info "Updating nixploy → ${APP_IMAGE}"
		docker service update \
			--image "${APP_IMAGE}" \
			--env-add "BETTER_AUTH_URL=${BETTER_AUTH_URL}" \
			--env-add "NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}" \
			nixploy >/dev/null
		ok "Updated nixploy"
		return
	fi

	docker service create \
		--name nixploy \
		--network "${NETWORK_NAME}" \
		--constraint 'node.role == manager' \
		--replicas 1 \
		--publish "mode=host,target=3000,published=${NIXPLOY_PORT}" \
		"${env_args[@]}" \
		--mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
		--mount type=bind,source="${NIXPLOY_CONFIG_DIR}",target=/etc/nixploy \
		--update-order start-first \
		"${APP_IMAGE}" >/dev/null
	ok "Created nixploy (port ${NIXPLOY_PORT})"
}

wait_for_app() {
	info "Waiting for dashboard on :${NIXPLOY_PORT}…"
	local i code
	for i in $(seq 1 90); do
		code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${NIXPLOY_PORT}/setup" 2>/dev/null || true)"
		case "${code}" in
			200|302|307|308) ok "Dashboard responding (HTTP ${code})"; return ;;
		esac
		code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${NIXPLOY_PORT}/login" 2>/dev/null || true)"
		case "${code}" in
			200|302|307|308) ok "Dashboard responding (HTTP ${code})"; return ;;
		esac
		sleep 2
	done
	warn "App not healthy yet — check: docker service logs -f nixploy"
}

print_summary() {
	local url
	url="${BETTER_AUTH_URL:-$(detect_public_url)}"
	printf '\n'
	printf '%s┌─────────────────────────────────────────────────────────┐%s\n' "${C_GREEN}" "${C_RESET}"
	printf '%s│%s  %sNixploy is installed%s                                  %s│%s\n' "${C_GREEN}" "${C_RESET}" "${C_BOLD}" "${C_RESET}" "${C_GREEN}" "${C_RESET}"
	printf '%s└─────────────────────────────────────────────────────────┘%s\n' "${C_GREEN}" "${C_RESET}"
	printf '\n'
	printf '  %sSetup (first admin):%s  %s/setup\n' "${C_BOLD}" "${C_RESET}" "${url}"
	printf '  %sDashboard:%s            %s\n' "${C_BOLD}" "${C_RESET}" "${url}"
	printf '  %sConfig:%s               %s\n' "${C_BOLD}" "${C_RESET}" "${NIXPLOY_CONFIG_DIR}"
	printf '  %sSecrets:%s              %s\n' "${C_BOLD}" "${C_RESET}" "${ENV_FILE}"
	printf '\n'
	printf '  %sPublic registration is disabled after you create the owner.%s\n' "${C_DIM}" "${C_RESET}"
	printf '  Invite teammates later from Settings → Organization.\n'
	printf '\n'
	printf '  %sUseful commands%s\n' "${C_BOLD}" "${C_RESET}"
	printf '    docker service ls\n'
	printf '    docker service logs -f nixploy\n'
	printf '    docker service update --image %s nixploy\n' "${APP_IMAGE}"
	printf '\n'
}

main() {
	banner
	require_root

	step "Detecting operating system"
	detect_os

	step "Installing prerequisites"
	ensure_basics

	step "Ensuring Docker Engine"
	install_docker

	step "Initializing Docker Swarm"
	init_swarm
	ensure_network

	step "Writing config and secrets"
	write_env_file
	ensure_directories

	step "Pulling container images"
	pull_images

	step "Starting Postgres"
	create_postgres
	wait_for_postgres

	step "Starting Traefik + Nixploy"
	create_traefik
	create_app

	step "Health check"
	wait_for_app
	print_summary
}

main "$@"
