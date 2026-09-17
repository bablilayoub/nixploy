#!/usr/bin/env bash
#
# Nixploy installer.
#
#   curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/install.sh | sudo bash
#
# With a domain (recommended — real HTTPS via Let's Encrypt):
#
#   NIXPLOY_DOMAIN=panel.nixploy.com NIXPLOY_LETSENCRYPT_EMAIL=you@nixploy.com \
#     curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/install.sh | sudo bash
#
# Re-running is safe: existing secrets, BETTER_AUTH_URL, the dashboard router
# and the ACME email are kept unless you pass NIXPLOY_DOMAIN /
# NIXPLOY_LETSENCRYPT_EMAIL / NIXPLOY_PUBLIC_IP explicitly.
#
# Environment overrides:
#   NIXPLOY_DOMAIN               Dashboard domain (A record → this server)
#   NIXPLOY_LETSENCRYPT_EMAIL    ACME contact for Let's Encrypt. Without it (and without a
#                                domain) only the self-signed certificate is issued.
#   NIXPLOY_PUBLIC_IP            Public IPv4 of this host. Default: asks api.ipify.org,
#                                falling back to the primary interface address.
#   NIXPLOY_VERSION              App image tag. Prefer a release tag (e.g. v0.1.0).
#                                Default is the current release tag (not floating "latest").
#   NIXPLOY_IMAGE                Full image ref (overrides tag)
#   NIXPLOY_PORT                 Opt-in: ALSO publish the app on this host port (plain
#                                HTTP, all interfaces). Unset = Traefik only (:80/:443).
#   NIXPLOY_CONFIG_DIR           Host config directory          (default: /etc/nixploy)
#   NIXPLOY_NETWORK              Shared tenant overlay          (default: nixploy-network)
#                                The panel and Postgres sit on the separate, tenant-free
#                                `nixploy-internal` overlay; only Traefik joins both.
#   TRUSTED_PROXIES              Forwarded to the app            (default: 1 — Traefik fronts it)
#   LOG_LEVEL / LOG_FORMAT       Forwarded to the app when set (debug|info|warn|error / json)
#   DATABASE_POOL_MAX            Forwarded to the app when set
#   TZ                           Process timezone of the panel — every cron (backups,
#                                schedules, platform alerts) runs in it. Default: UTC.
#   Every other runtime knob listed in docs/install.md → "Runtime environment"
#   (NIXPLOY_DEPLOY_CONCURRENCY, NIXPLOY_WILDCARD_DOMAIN, DOCKER_SOCKET, …) is
#   forwarded to the service when it is set in this script's environment.
#   NIXPLOY_MEMORY_LIMIT         Memory limit of the nixploy service (default: 2g)
#   NIXPLOY_SPLIT_WORKER         1 = also create a `nixploy-worker` service and run the
#                                panel with NIXPLOY_ROLE=panel. Deploys, crons and the
#                                status reconciler move out of the panel process, so a
#                                panel restart (or an update) no longer kills in-flight
#                                builds. Same as passing --split-worker. Default: 0
#                                (single process). A re-run keeps an existing worker.
#   NIXPLOY_WORKER_MEMORY        Memory limit of the nixploy-worker service (default: 2g)
#   POSTGRES_VERSION             Postgres image tag             (default: 17-alpine)
#   TRAEFIK_VERSION              Traefik image tag              (default: v3.5.0)
#   NIXPLOY_SKIP_PORT_CHECK      1 = do not refuse to install when :80/:443 are taken
#   NIXPLOY_SKIP_DNS_CHECK       1 = do not compare NIXPLOY_DOMAIN's A record with the
#                                public IP (behind a proxy/CDN this mismatch is expected)
#   NIXPLOY_SKIP_DOCKER_INSTALL  1 = require pre-installed Docker (skip get.docker.com)
#   NIXPLOY_BUILD_FROM_SOURCE    1 = always build the image locally
#   NIXPLOY_REPO                 GitHub org/repo                (default: bablilayoub/nixploy)
#   NIXPLOY_BRANCH               Branch for assets/source       (default: main)
#   NIXPLOY_GITHUB_TOKEN         Fine-grained PAT (Contents: Read) for private repos.
#                                Also accepts GITHUB_TOKEN. Required under sudo when
#                                the repo is private — root does not see your user gitconfig.
#   NIXPLOY_RENDER_TRAEFIK_ONLY  1 = print the static traefik.yml this script writes, then
#                                exit (CI drift check; needs no root or Docker)
#
set -euo pipefail

NIXPLOY_VERSION="${NIXPLOY_VERSION:-v0.2.9}"
# NIXPLOY_PORT left unset unless the operator exports it (see create_app publish logic).
NIXPLOY_CONFIG_DIR="${NIXPLOY_CONFIG_DIR:-/etc/nixploy}"
# The host-side directory. Re-asserted after sourcing .env because older
# installs persisted the container path (/etc/nixploy) there.
HOST_CONFIG_DIR="${NIXPLOY_CONFIG_DIR}"
POSTGRES_VERSION="${POSTGRES_VERSION:-17-alpine}"
TRAEFIK_VERSION="${TRAEFIK_VERSION:-v3.5.0}"
NIXPLOY_MEMORY_LIMIT="${NIXPLOY_MEMORY_LIMIT:-2g}"
NIXPLOY_WORKER_MEMORY="${NIXPLOY_WORKER_MEMORY:-2g}"
# Opt-in two-process layout (see --split-worker). 0 = today's single process.
SPLIT_WORKER="${NIXPLOY_SPLIT_WORKER:-0}"
# Set by --no-split-worker: the only way to go back to one process.
SPLIT_WORKER_EXPLICIT_OFF=0
WORKER_SERVICE="nixploy-worker"
NIXPLOY_REPO="${NIXPLOY_REPO:-bablilayoub/nixploy}"
# Pin assets to the same release tag as the image unless overridden.
NIXPLOY_BRANCH="${NIXPLOY_BRANCH:-$NIXPLOY_VERSION}"

NETWORK_NAME="${NIXPLOY_NETWORK:-nixploy-network}"
# Panel ↔ Postgres. No tenant workload is ever attached to it, so a compromised
# app container cannot resolve `nixploy:3000` / `nixploy-postgres:5432`.
INTERNAL_NETWORK_NAME="nixploy-internal"
APP_IMAGE="${NIXPLOY_IMAGE:-ghcr.io/bablilayoub/nixploy:${NIXPLOY_VERSION}}"
POSTGRES_IMAGE="postgres:${POSTGRES_VERSION}"
TRAEFIK_IMAGE="traefik:${TRAEFIK_VERSION}"
ENV_FILE="${NIXPLOY_CONFIG_DIR}/.env"
LOG_FILE="/var/log/nixploy-install.log"
# Sentinel the app uses when no ACME contact is configured (Let's Encrypt rejects it).
ACME_EMAIL_UNSET="nixploy@localhost"

# Only explicit operator input may overwrite state on a re-run.
EXPLICIT_DOMAIN=0
EXPLICIT_EMAIL=0
EXPLICIT_PUBLIC_IP=0
if [ -n "${NIXPLOY_DOMAIN:-}" ]; then EXPLICIT_DOMAIN=1; fi
if [ -n "${NIXPLOY_LETSENCRYPT_EMAIL:-}" ]; then EXPLICIT_EMAIL=1; fi
if [ -n "${NIXPLOY_PUBLIC_IP:-}" ]; then EXPLICIT_PUBLIC_IP=1; fi

# "https://x.com/y" → "x.com"; "1.2.3.4:443" → "1.2.3.4"
url_host() {
	local h="${1#http://}"
	h="${h#https://}"
	h="${h%%/*}"
	h="${h%%:*}"
	printf '%s' "${h}"
}

is_ipv4() {
	[[ "${1:-}" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]
}

# Normalized dashboard domain, empty if unset. On re-runs without
# NIXPLOY_DOMAIN it is derived from the stored BETTER_AUTH_URL (write_env_file).
DASHBOARD_DOMAIN=""
if [ "${EXPLICIT_DOMAIN}" = "1" ]; then
	DASHBOARD_DOMAIN="$(url_host "${NIXPLOY_DOMAIN}")"
fi
ACME_EMAIL="${NIXPLOY_LETSENCRYPT_EMAIL:-}"

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
TOTAL_STEPS=10

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
	# Official convenience script (the conventional path for installers of this kind).
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

# ── host preflight ───────────────────────────────────────────────────────────
# Cheap checks that turn a confusing failure five minutes into the install
# (a raw `docker service create` error after the images are pulled) into one
# actionable line before anything is downloaded. Every check is skippable or
# a warning except rootless Docker, which cannot work at all.

# Listening TCP ports, one per line. ss (iproute2) first, then lsof, then
# netstat; prints nothing when none of them exist (the check then self-skips).
listening_ports() {
	if need_cmd ss; then
		ss -ltnH 2>/dev/null | awk '{print $4}' | sed 's/.*://'
	elif need_cmd lsof; then
		lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $9}' | sed 's/.*://'
	elif need_cmd netstat; then
		netstat -ltn 2>/dev/null | awk '/^tcp/ {print $4}' | sed 's/.*://'
	fi
}

# :80/:443 must be free for Traefik — unless nixploy-traefik already holds
# them (every re-run) or the operator terminates TLS elsewhere.
check_ports() {
	[ "${NIXPLOY_SKIP_PORT_CHECK:-0}" = "1" ] && { info "Port check skipped (NIXPLOY_SKIP_PORT_CHECK=1)"; return 0; }
	if docker service inspect nixploy-traefik >/dev/null 2>&1; then
		ok "Ports 80/443 held by the existing nixploy-traefik service"
		return 0
	fi
	local ports busy=""
	ports="$(listening_ports)"
	[ -n "${ports}" ] || { info "Port check skipped (no ss/lsof/netstat)"; return 0; }
	local port
	for port in 80 443; do
		printf '%s\n' "${ports}" | grep -qx "${port}" && busy="${busy} ${port}"
	done
	[ -n "${busy}" ] || { ok "Ports 80 and 443 are free"; return 0; }
	warn "Port(s)${busy} are already in use — Traefik cannot bind them."
	warn "Stop the other server (nginx/apache/caddy: systemctl stop nginx) or set NIXPLOY_SKIP_PORT_CHECK=1 to continue anyway."
	die "Ports${busy} in use"
}

# Free space in GiB on the filesystem holding $1 ("" when df cannot answer).
free_gib() {
	local blocks
	blocks="$(df -Pk "$1" 2>/dev/null | awk 'NR==2 {print $4}')" || return 0
	[ -n "${blocks}" ] || return 0
	printf '%s' "$((blocks / 1024 / 1024))"
}

# Images, build caches, Postgres data and app checkouts all land on disk.
# 5 GiB is the floor for one small app; the panel image alone is ~1 GiB.
check_disk() {
	local docker_root free_config free_docker
	mkdir -p "${NIXPLOY_CONFIG_DIR}" 2>/dev/null || true
	free_config="$(free_gib "${NIXPLOY_CONFIG_DIR}")"
	if [ -n "${free_config}" ] && [ "${free_config}" -lt 5 ]; then
		warn "Only ${free_config} GiB free on ${NIXPLOY_CONFIG_DIR} — builds, backups and image pulls need at least 5 GiB."
	elif [ -n "${free_config}" ]; then
		ok "Disk: ${free_config} GiB free on ${NIXPLOY_CONFIG_DIR}"
	fi
	docker_root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
	[ -n "${docker_root}" ] || return 0
	[ "${docker_root}" = "${NIXPLOY_CONFIG_DIR}" ] && return 0
	free_docker="$(free_gib "${docker_root}")"
	if [ -n "${free_docker}" ] && [ "${free_docker}" -lt 5 ]; then
		warn "Only ${free_docker} GiB free on the Docker root (${docker_root}) — image pulls will fail."
	elif [ -n "${free_docker}" ]; then
		ok "Disk: ${free_docker} GiB free on ${docker_root}"
	fi
}

# 2 GB is the documented minimum; a source build wants ~4 GB.
check_memory() {
	local kb gb
	kb="$(awk '/^MemTotal:/ {print $2; exit}' /proc/meminfo 2>/dev/null || true)"
	[ -n "${kb}" ] || return 0
	gb=$((kb / 1024 / 1024))
	if [ "${kb}" -lt 1900000 ]; then
		warn "This host has ~${gb} GB RAM. Nixploy needs 2 GB minimum (4 GB+ to build images locally); add swap or resize."
	else
		ok "Memory: ~${gb} GB"
	fi
}

# Rootless Docker has no Swarm, cannot bind :80/:443 and cannot share the
# socket the panel needs. There is no workaround — fail loudly and early.
check_rootless_docker() {
	local security
	security="$(docker info --format '{{range .SecurityOptions}}{{println .}}{{end}}' 2>/dev/null || true)"
	case "${security}" in
		*rootless*)
			die "Rootless Docker detected. Nixploy needs the root daemon (Swarm, host ports 80/443, /var/run/docker.sock). Install Docker Engine as root and re-run."
			;;
	esac
	ok "Docker daemon runs as root"
}

# An A record that does not point here burns Let's Encrypt failures (5 per
# account per hostname per hour) and leaves the panel on the self-signed cert.
check_domain_dns() {
	[ -n "${DASHBOARD_DOMAIN}" ] || return 0
	[ "${NIXPLOY_SKIP_DNS_CHECK:-0}" = "1" ] && { info "DNS check skipped (NIXPLOY_SKIP_DNS_CHECK=1)"; return 0; }
	local resolved="" expected
	expected="$(detect_public_ip)"
	if need_cmd getent; then
		resolved="$(getent ahostsv4 "${DASHBOARD_DOMAIN}" 2>/dev/null | awk '{print $1; exit}' || true)"
	elif need_cmd dig; then
		resolved="$(dig +short A "${DASHBOARD_DOMAIN}" 2>/dev/null | head -n 1 || true)"
	elif need_cmd host; then
		resolved="$(host -t A "${DASHBOARD_DOMAIN}" 2>/dev/null | awk '/has address/ {print $4; exit}' || true)"
	fi
	if [ -z "${resolved}" ]; then
		warn "${DASHBOARD_DOMAIN} does not resolve yet. Let's Encrypt will fail until the A record exists and has propagated."
	elif [ "${resolved}" = "${expected}" ]; then
		ok "DNS: ${DASHBOARD_DOMAIN} → ${resolved}"
	else
		warn "${DASHBOARD_DOMAIN} resolves to ${resolved}, but this host's public IP is ${expected}."
		warn "Behind a proxy/CDN this is expected; otherwise fix the A record first — Let's Encrypt rate-limits failed validations. Set NIXPLOY_SKIP_DNS_CHECK=1 to silence this."
	fi
}

host_preflight() {
	check_rootless_docker
	check_ports
	check_disk
	check_memory
	check_domain_dns
}

# Address of the primary interface (private on NAT'd clouds) — right for the
# Swarm advertise address, wrong for anything user-facing (see resolve_public_ip).
primary_iface_ip() {
	local ip
	ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}' || true)"
	ip="${ip:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
	printf '%s' "${ip}"
}

init_swarm() {
	local state
	state="$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || true)"
	if [ "${state}" = "active" ]; then
		ok "Swarm active"
	else
		local addr
		addr="$(primary_iface_ip)"
		addr="${addr:-127.0.0.1}"
		docker swarm init --advertise-addr "${addr}" >/dev/null
		ok "Swarm initialized (${addr})"
	fi
	ensure_network "${NETWORK_NAME}"
	ensure_network "${INTERNAL_NETWORK_NAME}"
}

# Idempotent attachable overlay. Swarm networks are cluster-scoped objects.
ensure_network() {
	local name="$1"
	if docker network inspect "${name}" >/dev/null 2>&1; then
		ok "Network ${name}"
	else
		docker network create --driver overlay --attachable "${name}" >/dev/null
		ok "Created network ${name}"
	fi
}

# Whether a swarm service is already attached to a network (the spec stores ids).
service_on_network() {
	local service="$1" network="$2" id
	id="$(docker network inspect "${network}" --format '{{.Id}}' 2>/dev/null || true)"
	[ -n "${id}" ] || return 1
	docker service inspect "${service}" \
		--format '{{range .Spec.TaskTemplate.Networks}}{{.Target}} {{end}}' 2>/dev/null \
		| tr ' ' '\n' | grep -qx "${id}"
}

# ── network segmentation migration ───────────────────────────────────────────
# Installs from before the segmentation change put `nixploy` and
# `nixploy-postgres` on the shared tenant overlay, where every application
# container could resolve `nixploy:3000` and `nixploy-postgres:5432`. Move them
# onto `nixploy-internal` and take them off the tenant overlay.
#
# Order matters and every step is idempotent:
#   1. Traefik joins `nixploy-internal` (it must still reach the panel);
#   2. Postgres joins `nixploy-internal`, then leaves the tenant overlay;
#   3. the panel joins `nixploy-internal`, then leaves the tenant overlay.
# Each `--network-add`/`--network-rm` recreates the service's tasks, so this
# runs without `--detach` to let one settle before the next starts.
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

migrate_internal_network() {
	ensure_network "${INTERNAL_NETWORK_NAME}"
	attach_internal_network nixploy-traefik
	attach_internal_network nixploy-postgres
	detach_tenant_network nixploy-postgres
	attach_internal_network nixploy
	detach_tenant_network nixploy
}

# ── secrets & config ─────────────────────────────────────────────────────────
random_hex() { openssl rand -hex "$1"; }

# Public IPv4 used for BETTER_AUTH_URL, the setup URL and the self-signed SAN.
# `ip route get` returns the NIC address, which on AWS/GCP/Azure/OCI is the
# private one — so ask the outside world first (same as the app's detectPublicIp).
PUBLIC_IP=""
PUBLIC_IP_SOURCE=""
resolve_public_ip() {
	[ -z "${PUBLIC_IP}" ] || return 0
	local ip=""
	if [ "${EXPLICIT_PUBLIC_IP}" = "1" ]; then
		ip="${NIXPLOY_PUBLIC_IP}"
		is_ipv4 "${ip}" || die "NIXPLOY_PUBLIC_IP must be an IPv4 address (got: ${ip})"
		PUBLIC_IP_SOURCE="NIXPLOY_PUBLIC_IP"
	else
		ip="$(curl -fsS --max-time 4 https://api.ipify.org 2>/dev/null || true)"
		if is_ipv4 "${ip}"; then
			PUBLIC_IP_SOURCE="api.ipify.org"
		else
			ip="$(primary_iface_ip)"
			PUBLIC_IP_SOURCE="primary interface"
		fi
	fi
	PUBLIC_IP="${ip:-127.0.0.1}"
}

detect_public_ip() {
	resolve_public_ip
	printf '%s' "${PUBLIC_IP}"
}

detect_public_url() {
	if [ -n "${DASHBOARD_DOMAIN}" ]; then
		printf 'https://%s' "${DASHBOARD_DOMAIN}"
	else
		printf 'https://%s' "$(detect_public_ip)"
	fi
}

# Source .env (exporting everything) and re-assert the host config dir: the
# file may still carry NIXPLOY_CONFIG_DIR=/etc/nixploy from older installs.
load_env_file() {
	set -a
	# shellcheck disable=SC1090
	. "${ENV_FILE}"
	set +a
	NIXPLOY_CONFIG_DIR="${HOST_CONFIG_DIR}"
	ENV_FILE="${HOST_CONFIG_DIR}/.env"
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

unset_env_var() {
	local name="$1" tmp
	tmp="$(mktemp)"
	awk -v k="${name}" '$0 ~ "^"k"=" { next } { print }' "${ENV_FILE}" > "${tmp}"
	mv "${tmp}" "${ENV_FILE}"
	chmod 600 "${ENV_FILE}"
}

write_env_file() {
	mkdir -p "${NIXPLOY_CONFIG_DIR}"
	chmod 700 "${NIXPLOY_CONFIG_DIR}"

	if [ -f "${ENV_FILE}" ]; then
		load_env_file
		if grep -q '^NIXPLOY_CONFIG_DIR=' "${ENV_FILE}"; then
			# The container path is set on the service; keeping it here clobbered
			# the host override whenever the file was sourced.
			unset_env_var NIXPLOY_CONFIG_DIR
			ok "Removed NIXPLOY_CONFIG_DIR from ${ENV_FILE} (set on the service instead)"
		fi

		local existing_url="${BETTER_AUTH_URL:-}" existing_host public_url
		existing_host="$(url_host "${existing_url}")"
		if [ "${EXPLICIT_DOMAIN}" = "1" ]; then
			public_url="https://${DASHBOARD_DOMAIN}"
		elif [ "${EXPLICIT_PUBLIC_IP}" = "1" ] && { [ -z "${existing_host}" ] || is_ipv4 "${existing_host}"; }; then
			public_url="https://$(detect_public_ip)"
		else
			# Non-destructive re-run: keep the stored URL and derive the domain from it
			# (mirrors getDashboardDomain in the app).
			public_url="${existing_url}"
			if [ -n "${existing_host}" ] && [ "${existing_host}" != "localhost" ] && ! is_ipv4 "${existing_host}"; then
				DASHBOARD_DOMAIN="${existing_host}"
			fi
		fi
		[ -n "${public_url}" ] || public_url="$(detect_public_url)"

		if [ "${existing_url}" != "${public_url}" ]; then
			set_env_var "BETTER_AUTH_URL" "${public_url}"
			load_env_file
			ok "Updated public URL → ${public_url}"
		else
			ok "Keeping existing secrets and public URL (${ENV_FILE})"
		fi
		if is_ipv4 "${existing_host}" && [ "${existing_host}" != "$(detect_public_ip)" ] && [ "${existing_url}" = "${public_url}" ]; then
			warn "BETTER_AUTH_URL still points at ${existing_host} but this host's public IP is $(detect_public_ip)."
			warn "Re-run with NIXPLOY_PUBLIC_IP=$(detect_public_ip) (or NIXPLOY_DOMAIN=…) to move the panel URL."
		fi
		return
	fi

	local public_url
	public_url="$(detect_public_url)"
	umask 077
	cat > "${ENV_FILE}" <<EOF
# Generated by Nixploy install.sh — do not commit.
POSTGRES_USER=nixploy
POSTGRES_PASSWORD=$(random_hex 24)
POSTGRES_DB=nixploy
BETTER_AUTH_SECRET=$(random_hex 32)
BETTER_AUTH_URL=${public_url}
NIXPLOY_SETUP_TOKEN=$(random_hex 16)
ENCRYPTION_KEY=$(random_hex 32)
PORT=3000
# Two-process layout: set NIXPLOY_SPLIT_WORKER=1 in the *installer's*
# environment (or pass --split-worker) and re-run install.sh to move deploys,
# crons and the status reconciler into a separate \`nixploy-worker\` service.
# This file is the shared env of both services; the role itself is set per
# service (NIXPLOY_ROLE=panel / worker), never here.
# NIXPLOY_SPLIT_WORKER=1
EOF
	set_env_var "DATABASE_URL" "postgres://nixploy:$(awk -F= '/^POSTGRES_PASSWORD=/{print $2}' "${ENV_FILE}")@nixploy-postgres:5432/nixploy"
	ok "Generated secrets (${ENV_FILE})"
	load_env_file
}

# Static Traefik config. Keep byte-identical to
# packages/server/src/modules/traefik/setup.ts#buildTraefikStaticConfig and
# docker/traefik/traefik.yml — CI renders all of them and diffs
# (NIXPLOY_RENDER_TRAEFIK_ONLY=1 bash install.sh).
#
# No entrypoint-level HTTP → HTTPS redirect: it would override every domain's
# `https` toggle. The panel emits a per-router `redirectScheme` middleware for
# each `https: true` domain, so `https: false` domains stay plain on :80.
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

# ACME email currently stored in a traefik.yml, ignoring placeholders.
existing_acme_email() {
	local file="$1" email=""
	[ -f "${file}" ] || return 0
	email="$(awk -F': *' '/^[[:space:]]*email:/{print $2; exit}' "${file}" 2>/dev/null || true)"
	case "${email}" in
		""|"${ACME_EMAIL_UNSET}"|admin@example.com) ;;
		*) printf '%s' "${email}" ;;
	esac
}

write_traefik_static() {
	local file="${NIXPLOY_CONFIG_DIR}/traefik/traefik.yml" email="${ACME_EMAIL}" guessed=0
	if [ "${EXPLICIT_EMAIL}" != "1" ]; then
		# Re-run: never touch the Let's Encrypt account contact unless asked to.
		email="$(existing_acme_email "${file}")"
		if [ -z "${email}" ] && [ -n "${DASHBOARD_DOMAIN}" ]; then
			email="admin@${DASHBOARD_DOMAIN}"
			guessed=1
		fi
	fi
	email="${email:-${ACME_EMAIL_UNSET}}"
	ACME_EMAIL="${email}"
	render_traefik_static "${email}" > "${file}"
	if [ "${email}" = "${ACME_EMAIL_UNSET}" ]; then
		ok "Traefik static config (self-signed certificate)"
		warn "No ACME email: Let's Encrypt rejects '${ACME_EMAIL_UNSET}', so app domains cannot get real certificates yet."
		warn "Set NIXPLOY_LETSENCRYPT_EMAIL=you@example.com (re-run) or Settings → Platform → Let's Encrypt email."
	elif [ "${guessed}" = "1" ]; then
		ok "Traefik static config (ACME email ${email})"
		warn "ACME email defaulted to ${email} — set NIXPLOY_LETSENCRYPT_EMAIL to receive certificate notices."
	else
		ok "Traefik static config (ACME email ${email})"
	fi
}

write_tls_and_routing() {
	local dyn="${NIXPLOY_CONFIG_DIR}/traefik/dynamic"
	local cert="${dyn}/default.crt" key="${dyn}/default.key"
	local router_file="${dyn}/00-nixploy-dashboard.yml"
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

	# The router file may carry a domain configured later in Settings → Platform;
	# only an explicit NIXPLOY_DOMAIN may rewrite it.
	if [ -f "${router_file}" ] && [ "${EXPLICIT_DOMAIN}" != "1" ]; then
		ok "Keeping existing dashboard routing (${router_file})"
		return
	fi

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
	cat > "${router_file}" <<EOF
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
# Clone URL for private repos: embed the PAT so `sudo` does not prompt for a password.
repo_clone_url() {
	local token="${NIXPLOY_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}"
	if [ -n "${token}" ]; then
		# x-access-token works for fine-grained and classic PATs.
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
	local tmp version
	tmp="$(mktemp -d)"
	info "Building from source — this takes several minutes (~4GB RAM needed)"
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
# json-file with rotation: the panel reads `docker service logs`, which needs
# json-file/journald, and an unbounded log fills small hosts.
LOG_ARGS=(--log-driver json-file --log-opt max-size=10m --log-opt max-file=3)
# Roll safety: the image HEALTHCHECK gates readiness; a task that dies within
# the monitor window rolls the service back to the previous spec.
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

# Runtime knobs forwarded to the `nixploy` service, only when the operator set
# them. Everything here is documented in docs/install.md → "Runtime
# environment"; keep the two lists (and update.sh's copy) in sync — a knob that
# is not forwarded has to be re-applied by hand after every update.
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

# $1 is the flag to emit (--env for create, --env-add for update).
APP_ENV_ARGS=()
collect_app_env_args() {
	local flag="$1" name
	APP_ENV_ARGS=(
		"${flag}" "TRUSTED_PROXIES=${TRUSTED_PROXIES:-1}"
		"${flag}" "NIXPLOY_IMAGE=${APP_IMAGE}"
		"${flag}" "NIXPLOY_ROLE=$(app_role)"
	)
	for name in "${FORWARDED_APP_ENV[@]}"; do
		if [ -n "${!name:-}" ]; then
			APP_ENV_ARGS+=("${flag}" "${name}=${!name}")
		fi
	done
}

# Whether this install runs the two-process layout. An existing
# `nixploy-worker` service keeps the split on across re-runs — an operator who
# opted in once must not lose it by re-running the one-liner without the flag —
# unless they explicitly ask for one process again with --no-split-worker.
resolve_split_worker() {
	if [ "${SPLIT_WORKER_EXPLICIT_OFF}" = "1" ]; then
		SPLIT_WORKER=0
		return
	fi
	# .env has been sourced by now, so NIXPLOY_SPLIT_WORKER=1 can also live there.
	if [ "${NIXPLOY_SPLIT_WORKER:-0}" = "1" ]; then
		SPLIT_WORKER=1
	fi
	if docker service inspect "${WORKER_SERVICE}" >/dev/null 2>&1; then
		SPLIT_WORKER=1
	fi
}

# Role of the `nixploy` service: `panel` when the worker owns the background
# work, `all` (single process) otherwise.
app_role() {
	[ "${SPLIT_WORKER}" = "1" ] && printf 'panel' || printf 'all'
}

create_postgres() {
	if docker service inspect nixploy-postgres >/dev/null 2>&1; then
		ok "Service nixploy-postgres (existing)"
		return
	fi
	# Only the three POSTGRES_* values (exported from .env) — never the whole
	# file, which would put the panel's secrets into the database container.
	# Health: pg_isready inside the container (env expands there, hence the
	# single quotes). 60 s grace lets a checkpoint finish on stop.
	docker service create \
		--name nixploy-postgres \
		--network "${INTERNAL_NETWORK_NAME}" \
		--constraint 'node.role == manager' \
		--replicas 1 \
		--detach \
		--env POSTGRES_USER --env POSTGRES_PASSWORD --env POSTGRES_DB \
		--mount type=volume,source=nixploy-postgres-data,target=/var/lib/postgresql/data \
		--health-cmd 'pg_isready -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
		--health-interval 10s --health-timeout 5s --health-retries 5 --health-start-period 30s \
		--stop-grace-period 60s \
		"${LOG_ARGS[@]}" \
		"${POSTGRES_IMAGE}" >/dev/null
	ok "Created nixploy-postgres"
}

wait_for_postgres() {
	local i
	for i in $(seq 1 60); do
		if docker run --rm --network "${INTERNAL_NETWORK_NAME}" "${POSTGRES_IMAGE}" \
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
		--network "${INTERNAL_NETWORK_NAME}" \
		--mode global \
		--constraint 'node.role == manager' \
		--detach \
		--publish mode=host,target=80,published=80 \
		--publish mode=host,target=443,published=443 \
		--mount type=bind,source="${NIXPLOY_CONFIG_DIR}/traefik/traefik.yml",target=/etc/traefik/traefik.yml,readonly \
		--mount type=bind,source="${NIXPLOY_CONFIG_DIR}/traefik/dynamic",target=/etc/nixploy/traefik/dynamic \
		--mount type=bind,source="${NIXPLOY_CONFIG_DIR}/traefik/acme.json",target=/etc/nixploy/traefik/acme.json \
		"${LOG_ARGS[@]}" \
		"${TRAEFIK_IMAGE}" >/dev/null
	ok "Created nixploy-traefik (:80 → :443)"
}

# Host port currently published for the app's :3000 (empty when none).
app_published_port() {
	docker service inspect nixploy \
		--format '{{if .Spec.EndpointSpec}}{{range .Spec.EndpointSpec.Ports}}{{.TargetPort}}:{{.PublishedPort}} {{end}}{{end}}' 2>/dev/null \
		| tr ' ' '\n' | awk -F: '$1 == 3000 { print $2; exit }' || true
}

create_app() {
	# The panel is served by Traefik on :443; :3000 is only published when asked
	# (plain HTTP, and Swarm host-mode cannot bind to 127.0.0.1 only).
	local publish_args=()
	if [ -n "${NIXPLOY_PORT:-}" ]; then
		publish_args=(--publish "mode=host,target=3000,published=${NIXPLOY_PORT}")
	fi

	if docker service inspect nixploy >/dev/null 2>&1; then
		collect_app_env_args --env-add
		local current_port update_publish=()
		current_port="$(app_published_port)"
		if [ -n "${NIXPLOY_PORT:-}" ] && [ "${current_port}" != "${NIXPLOY_PORT}" ]; then
			[ -z "${current_port}" ] || update_publish+=(--publish-rm 3000)
			update_publish+=(--publish-add "mode=host,target=3000,published=${NIXPLOY_PORT}")
		elif [ -z "${NIXPLOY_PORT:-}" ] && [ -n "${current_port}" ]; then
			info "Port ${current_port} is still host-published from an earlier install (plain HTTP)."
			info "Remove it with: docker service update --publish-rm 3000 nixploy"
		fi
		# stop-first: a host-published port can never be bound by a second task
		# while the old one runs (start-first deadlocks the update).
		docker service update \
			--detach --force --no-resolve-image \
			--image "${APP_IMAGE}" \
			"${ROLL_ARGS[@]}" \
			"${SERVICE_ARGS[@]}" \
			"${LOG_ARGS[@]}" \
			--env-add "BETTER_AUTH_URL=${BETTER_AUTH_URL}" \
			--env-add NIXPLOY_CONFIG_DIR=/etc/nixploy \
			--env-add NIXPLOY_DISABLE_TRAEFIK_BOOT=1 \
			"${APP_ENV_ARGS[@]}" \
			${update_publish[@]+"${update_publish[@]}"} \
			nixploy >/dev/null
		ok "Updated nixploy → ${APP_IMAGE}"
		return
	fi
	collect_app_env_args --env
	docker service create \
		--name nixploy \
		--network "${INTERNAL_NETWORK_NAME}" \
		--constraint 'node.role == manager' \
		--replicas 1 \
		--detach \
		--no-resolve-image \
		${publish_args[@]+"${publish_args[@]}"} \
		--env-file "${ENV_FILE}" \
		--env DATABASE_URL --env BETTER_AUTH_SECRET --env BETTER_AUTH_URL \
		--env ENCRYPTION_KEY \
		--env PORT=3000 \
		--env NIXPLOY_CONFIG_DIR=/etc/nixploy \
		--env NIXPLOY_DISABLE_TRAEFIK_BOOT=1 \
		"${APP_ENV_ARGS[@]}" \
		--mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
		--mount type=bind,source="${NIXPLOY_CONFIG_DIR}",target=/etc/nixploy \
		"${ROLL_ARGS[@]}" \
		"${SERVICE_ARGS[@]}" \
		"${LOG_ARGS[@]}" \
		"${APP_IMAGE}" >/dev/null
	ok "Created nixploy"
}

# ── worker (opt-in second process) ───────────────────────────────────────────
# Same image, same .env, same config volume and docker socket — only
# NIXPLOY_ROLE differs. It joins `nixploy-internal` (Postgres + panel) and
# NOTHING else: it never fronts traffic, so it is not on the tenant overlay and
# publishes no host port. Its :3001 answers /api/health, /api/ready and
# /api/version for the image HEALTHCHECK.
#
# What moves here: the deploy claim loop, boot recovery, every cron (backups,
# schedules, metrics, uptime, reconciler, maintenance, update checker, image
# auto-update, platform alerts) and the Traefik bootstrap. The panel keeps
# enqueueing deploys and writing per-domain Traefik YAML, which is why both
# services mount the config directory.
WORKER_PORT=3001

create_worker() {
	if [ "${SPLIT_WORKER}" != "1" ]; then
		remove_worker_if_present
		return
	fi

	collect_app_env_args --env-add
	if docker service inspect "${WORKER_SERVICE}" >/dev/null 2>&1; then
		docker service update \
			--detach --force --no-resolve-image \
			--image "${APP_IMAGE}" \
			"${ROLL_ARGS[@]}" \
			--stop-grace-period 90s \
			--limit-memory "${NIXPLOY_WORKER_MEMORY}" \
			--reserve-memory 512m \
			"${LOG_ARGS[@]}" \
			--env-add "BETTER_AUTH_URL=${BETTER_AUTH_URL}" \
			--env-add NIXPLOY_CONFIG_DIR=/etc/nixploy \
			--env-add NIXPLOY_DISABLE_TRAEFIK_BOOT=1 \
			--env-add "PORT=${WORKER_PORT}" \
			"${APP_ENV_ARGS[@]}" \
			--env-add NIXPLOY_ROLE=worker \
			"${WORKER_SERVICE}" >/dev/null
		ok "Updated ${WORKER_SERVICE} → ${APP_IMAGE}"
		return
	fi

	collect_app_env_args --env
	docker service create \
		--name "${WORKER_SERVICE}" \
		--network "${INTERNAL_NETWORK_NAME}" \
		--constraint 'node.role == manager' \
		--replicas 1 \
		--detach \
		--no-resolve-image \
		--env-file "${ENV_FILE}" \
		--env DATABASE_URL --env BETTER_AUTH_SECRET --env BETTER_AUTH_URL \
		--env ENCRYPTION_KEY \
		--env "PORT=${WORKER_PORT}" \
		--env NIXPLOY_CONFIG_DIR=/etc/nixploy \
		--env NIXPLOY_DISABLE_TRAEFIK_BOOT=1 \
		"${APP_ENV_ARGS[@]}" \
		--env NIXPLOY_ROLE=worker \
		--mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
		--mount type=bind,source="${NIXPLOY_CONFIG_DIR}",target=/etc/nixploy \
		"${ROLL_ARGS[@]}" \
		--stop-grace-period 90s \
		--limit-memory "${NIXPLOY_WORKER_MEMORY}" \
		--reserve-memory 512m \
		"${LOG_ARGS[@]}" \
		"${APP_IMAGE}" >/dev/null
	ok "Created ${WORKER_SERVICE} (deploy queue + crons)"
}

# Going back to one process: the panel is already NIXPLOY_ROLE=all by the time
# this runs, so removing the service is enough — nothing is left unowned.
remove_worker_if_present() {
	docker service inspect "${WORKER_SERVICE}" >/dev/null 2>&1 || return 0
	if docker service rm "${WORKER_SERVICE}" >/dev/null 2>&1; then
		ok "Removed ${WORKER_SERVICE} (single-process mode)"
	else
		warn "Could not remove ${WORKER_SERVICE} — run: docker service rm ${WORKER_SERVICE}"
	fi
}

# ── readiness ────────────────────────────────────────────────────────────────
# Through Traefik on loopback with the real host name: works before DNS has
# propagated and does not need :3000 published. $1 = host, $2 = path. Prints
# the HTTP status ("" on connection failure).
probe_via_traefik() {
	curl -sk -o /dev/null -w '%{http_code}' --connect-timeout 2 --max-time 12 \
		--resolve "${1}:443:127.0.0.1" "https://${1}${2}" 2>/dev/null || true
}

# Inside the running nixploy task, exactly what the image HEALTHCHECK runs:
# no Traefik, DNS, certificate or published port involved, so "the app is
# up" and "the app is reachable through the proxy" are told apart. $1 is
# unused (target), $2 = path. Prints the HTTP status ("" when no task runs).
probe_via_exec() {
	local cid
	cid="$(docker ps -q -f label=com.docker.swarm.service.name=nixploy 2>/dev/null | head -n 1)"
	[ -n "${cid}" ] || return 0
	docker exec "${cid}" sh -c "curl -s -o /dev/null -w '%{http_code}' --connect-timeout 2 --max-time 12 \"http://127.0.0.1:\${PORT:-3000}${2}\"" 2>/dev/null || true
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
	# The in-container probe is authoritative for "the new task serves";
	# the proxy and port probes are how operators reach it.
	probe_ready probe_via_exec "" && return 0
	probe_ready probe_via_traefik "${host}" && return 0
	[ -n "${port}" ] && probe_ready probe_via_port "${port}" && return 0
	return 1
}

# Swarm update state of the nixploy service ("" right after create).
app_update_state() {
	docker service inspect nixploy --format '{{if .UpdateStatus}}{{.UpdateStatus.State}}{{end}}' 2>/dev/null || true
}

wait_for_app() {
	local url host port state="" ready=0 i
	url="${BETTER_AUTH_URL:-$(detect_public_url)}"
	host="$(url_host "${url}")"
	port="${NIXPLOY_PORT:-$(app_published_port)}"
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
			printf '\r   %s%s%s Waiting for the app to start (%d/120)' \
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
			die "The new image failed its health check and was rolled back — inspect: docker service ps nixploy · logs: docker service logs nixploy"
			;;
	esac
	if [ "${ready}" != "1" ]; then
		warn "App not responding after ~4 minutes"
		docker service ps nixploy --no-trunc 2>/dev/null | head -n 6 >&2 || true
		docker service logs --tail 50 nixploy >&2 2>/dev/null || true
		die "Startup failed — debug: docker service logs -f nixploy · roll back: docker service rollback nixploy"
	fi
	if probe_ready probe_via_traefik "${host}"; then
		ok "App is up (via Traefik on this host)"
	else
		ok "App is up (new task answers /api/ready)"
		warn "Not reachable through Traefik as https://${host} from this host yet — DNS or the dashboard domain may still be settling"
	fi

	# Public reachability is informational only: DNS may not have propagated yet.
	local code
	code="$(curl -sk -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 8 "${url}/setup" 2>/dev/null || true)"
	if is_ready_code "${code}"; then
		ok "HTTPS ready at ${url}"
	elif [ -n "${DASHBOARD_DOMAIN}" ]; then
		warn "${url} is not reachable from this host yet — DNS propagation, firewall or NAT. The panel itself is up."
	else
		warn "${url} did not answer from this host (NAT/firewall?) — the panel itself is up; give Traefik a few seconds."
	fi
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
	if [ -n "${NIXPLOY_SETUP_TOKEN:-}" ]; then
		printf '   %s→%s  %s%s/setup?token=%s%s\n' "${C_GREEN}" "${C_RESET}" "${C_BOLD}${C_CYAN}" "${url}" "${NIXPLOY_SETUP_TOKEN}" "${C_RESET}"
		printf '   %sSetup token: %s — stored in %s as NIXPLOY_SETUP_TOKEN; it is needed once,%s\n' "${C_DIM}" "${NIXPLOY_SETUP_TOKEN}" "${ENV_FILE}" "${C_RESET}"
		printf '   %sto create the first admin. Remove the line afterwards if you like.%s\n' "${C_DIM}" "${C_RESET}"
	else
		printf '   %s→%s  %s%s/setup%s\n' "${C_GREEN}" "${C_RESET}" "${C_BOLD}${C_CYAN}" "${url}" "${C_RESET}"
	fi
	printf '\n'
	if [ -n "${DASHBOARD_DOMAIN}" ]; then
		printf '   %sThe Let'"'"'s Encrypt certificate is issued on first visit.%s\n' "${C_DIM}" "${C_RESET}"
		printf '   %sMake sure the DNS A record of %s points here.%s\n' "${C_DIM}" "${DASHBOARD_DOMAIN}" "${C_RESET}"
	else
		printf '   %sThe certificate is self-signed — accept the browser warning once.%s\n' "${C_DIM}" "${C_RESET}"
		printf '   %sAdd a real domain later in Settings → Platform → Dashboard domain.%s\n' "${C_DIM}" "${C_RESET}"
	fi
	if [ "${ACME_EMAIL}" = "${ACME_EMAIL_UNSET}" ]; then
		printf '   %sLet'"'"'s Encrypt needs a contact email: Settings → Platform → Let'"'"'s Encrypt email.%s\n' "${C_DIM}" "${C_RESET}"
	fi
	printf '\n'
	print_firewall_hint
	printf '   %sConfig%s   %s\n' "${C_DIM}" "${C_RESET}" "${NIXPLOY_CONFIG_DIR}"
	if [ "${SPLIT_WORKER}" = "1" ]; then
		printf '   %sRoles%s    nixploy (panel, %s) + %s (deploys & crons, %s)\n' \
			"${C_DIM}" "${C_RESET}" "${NIXPLOY_MEMORY_LIMIT}" "${WORKER_SERVICE}" "${NIXPLOY_WORKER_MEMORY}"
		printf '   %sLogs%s     docker service logs -f nixploy · docker service logs -f %s\n' \
			"${C_DIM}" "${C_RESET}" "${WORKER_SERVICE}"
	else
		printf '   %sLogs%s     docker service logs -f nixploy\n' "${C_DIM}" "${C_RESET}"
	fi
	printf '   %sUpdate%s   curl -fsSL …/update.sh | sudo bash\n' "${C_DIM}" "${C_RESET}"
	printf '   %sRemove%s   curl -fsSL …/uninstall.sh | sudo bash\n' "${C_DIM}" "${C_RESET}"
	printf '\n'
}

# Ports 80/443 must be reachable from the internet or Let's Encrypt's HTTP-01
# challenge (and the panel) never answer. Print the one-liner for whichever
# firewall this host actually runs.
print_firewall_hint() {
	local shown=0
	printf '   %sOpen the firewall for HTTP/HTTPS:%s\n' "${C_BOLD}" "${C_RESET}"
	if need_cmd ufw && ufw status 2>/dev/null | grep -qi '^Status: active'; then
		printf '   %s→%s  ufw allow 80,443/tcp\n' "${C_GREEN}" "${C_RESET}"
		shown=1
	fi
	if need_cmd firewall-cmd && firewall-cmd --state >/dev/null 2>&1; then
		printf '   %s→%s  firewall-cmd --permanent --add-service=http --add-service=https && firewall-cmd --reload\n' "${C_GREEN}" "${C_RESET}"
		shown=1
	fi
	if [ "${shown}" = "0" ]; then
		printf '   %sufw:%s         ufw allow 80,443/tcp\n' "${C_DIM}" "${C_RESET}"
		printf '   %sfirewalld:%s   firewall-cmd --permanent --add-service=http --add-service=https && firewall-cmd --reload\n' "${C_DIM}" "${C_RESET}"
		printf '   %sCloud:%s       also open 80/443 in the provider'"'"'s security group.\n' "${C_DIM}" "${C_RESET}"
	fi
	printf '\n'
}

# Flags. Everything else is an environment variable (the one-liner is piped
# into bash, where flags need `bash -s -- --flag`), so this stays tiny.
parse_args() {
	while [ $# -gt 0 ]; do
		case "$1" in
			--split-worker) SPLIT_WORKER=1 ;;
			--no-split-worker) SPLIT_WORKER=0; SPLIT_WORKER_EXPLICIT_OFF=1 ;;
			-h|--help)
				printf 'Usage: install.sh [--split-worker|--no-split-worker]\n'
				printf '  --split-worker      run deploys and crons in a separate nixploy-worker service\n'
				printf '  --no-split-worker   collapse an existing split install back to one process\n'
				printf '  Every other knob is an environment variable — see the header of this file.\n'
				exit 0
				;;
			*) die "Unknown argument: $1 (try --help)" ;;
		esac
		shift
	done
}

main() {
	parse_args "$@"
	if [ "${NIXPLOY_RENDER_TRAEFIK_ONLY:-0}" = "1" ]; then
		render_traefik_static "${ACME_EMAIL:-${ACME_EMAIL_UNSET}}"
		exit 0
	fi

	banner
	require_root
	: > "${LOG_FILE}" 2>/dev/null || LOG_FILE="/tmp/nixploy-install.log"

	step "Operating system"
	detect_os

	step "Prerequisites"
	ensure_basics

	step "Docker Engine"
	install_docker

	step "Host preflight"
	host_preflight

	step "Docker Swarm"
	init_swarm

	step "Config & secrets"
	resolve_public_ip
	ok "Public IP: ${PUBLIC_IP} (${PUBLIC_IP_SOURCE})"
	write_env_file
	ensure_directories

	step "Container images"
	pull_images

	step "Network segmentation"
	migrate_internal_network

	step "Database"
	create_postgres
	wait_for_postgres

	step "Traefik & Nixploy"
	resolve_split_worker
	create_traefik
	create_app
	create_worker

	step "Health check"
	wait_for_app
	print_summary
}

main "$@"
