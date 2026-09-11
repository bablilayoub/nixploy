#!/usr/bin/env bash
#
# Nixploy uninstaller — remove the platform services this host runs.
#
#   curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/uninstall.sh | sudo bash
#
# Default (safe): removes the platform services (`nixploy`, `nixploy-worker`
# when a split install created it, `nixploy-postgres`, `nixploy-traefik`) and
# the two platform overlays, and KEEPS the Postgres volume and the config
# directory — so a later install.sh on the same host brings everything back
# exactly as it was.
#
#   --purge   ALSO delete the `nixploy-postgres-data` volume and the config
#             directory (secrets, Let's Encrypt certificates, SSH keys, app
#             checkouts). This is irreversible and asks you to type the
#             confirmation phrase.
#
# Tenant services deployed through Nixploy are NOT touched: they are ordinary
# Swarm services / compose stacks and may be running things you still want.
# `--tenants` removes those too (everything on the tenant overlay).
#
# Environment overrides:
#   NIXPLOY_CONFIG_DIR   Host config directory      (default: /etc/nixploy)
#   NIXPLOY_NETWORK      Shared tenant overlay      (default: nixploy-network)
#   NIXPLOY_YES          1 = skip the confirmation prompt (non-interactive use;
#                        still required together with --purge, see below)
#
set -euo pipefail

NIXPLOY_CONFIG_DIR="${NIXPLOY_CONFIG_DIR:-/etc/nixploy}"
NETWORK_NAME="${NIXPLOY_NETWORK:-nixploy-network}"
INTERNAL_NETWORK_NAME="nixploy-internal"
POSTGRES_VOLUME="nixploy-postgres-data"
# `nixploy-worker` only exists in a split install (install.sh --split-worker);
# `docker service rm` on a missing service is handled by the caller's `|| true`.
# It is listed FIRST so the deploy queue stops claiming before the panel and
# the database go away.
PLATFORM_SERVICES=(nixploy-worker nixploy nixploy-traefik nixploy-postgres)
CONFIRM_PHRASE="delete nixploy data"

PURGE=0
REMOVE_TENANTS=0
for arg in "$@"; do
	case "${arg}" in
		--purge) PURGE=1 ;;
		--tenants) REMOVE_TENANTS=1 ;;
		-h|--help) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) printf 'Unknown option: %s (try --help)\n' "${arg}" >&2; exit 2 ;;
	esac
done

# ── output helpers ───────────────────────────────────────────────────────────
if [ -t 1 ] && [ "${NO_COLOR:-}" = "" ]; then
	C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
	C_CYAN=$'\033[36m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'
else
	C_RESET=""; C_BOLD=""; C_DIM=""; C_CYAN=""; C_GREEN=""; C_YELLOW=""; C_RED=""
fi

ok()   { printf '   %s✓%s %s\n' "${C_GREEN}" "${C_RESET}" "$*"; }
info() { printf '   %s•%s %s\n' "${C_CYAN}" "${C_RESET}" "$*"; }
warn() { printf '   %s!%s %s\n' "${C_YELLOW}" "${C_RESET}" "$*" >&2; }
die()  { printf '\n   %s✗ ERROR:%s %s\n\n' "${C_RED}${C_BOLD}" "${C_RESET}" "$*" >&2; exit 1; }

need_cmd() { command -v "$1" >/dev/null 2>&1; }

require_root() {
	[ "$(id -u)" -eq 0 ] || die "Run as root: curl -fsSL <url> | sudo bash"
}

require_docker() {
	need_cmd docker || die "Docker is not installed — nothing to uninstall"
	docker info >/dev/null 2>&1 || die "Docker daemon is not running"
}

# Services on the tenant overlay that are not the platform's own.
tenant_services() {
	local id name network_id
	network_id="$(docker network inspect "${NETWORK_NAME}" --format '{{.Id}}' 2>/dev/null || true)"
	[ -n "${network_id}" ] || return 0
	for id in $(docker service ls --quiet 2>/dev/null); do
		name="$(docker service inspect "${id}" --format '{{.Spec.Name}}' 2>/dev/null || true)"
		[ -n "${name}" ] || continue
		case " ${PLATFORM_SERVICES[*]} " in *" ${name} "*) continue ;; esac
		docker service inspect "${id}" \
			--format '{{range .Spec.TaskTemplate.Networks}}{{.Target}} {{end}}' 2>/dev/null \
			| tr ' ' '\n' | grep -qx "${network_id}" && printf '%s\n' "${name}"
	done
}

# ── plan ─────────────────────────────────────────────────────────────────────
# Nothing is removed before the operator has seen the full list.
print_plan() {
	local service tenants
	printf '\n  %sNixploy uninstall — this will:%s\n\n' "${C_BOLD}" "${C_RESET}"
	for service in "${PLATFORM_SERVICES[@]}"; do
		if docker service inspect "${service}" >/dev/null 2>&1; then
			printf '   %s·%s remove Swarm service %s\n' "${C_RED}" "${C_RESET}" "${service}"
		elif [ "${service}" = "nixploy-worker" ]; then
			: # only exists in a split install — saying "not present" is noise
		else
			printf '   %s·%s (service %s is not present)\n' "${C_DIM}" "${C_RESET}" "${service}"
		fi
	done
	if [ "${REMOVE_TENANTS}" = "1" ]; then
		tenants="$(tenant_services | tr '\n' ' ')"
		if [ -n "${tenants% }" ]; then
			printf '   %s·%s remove tenant services: %s\n' "${C_RED}" "${C_RESET}" "${tenants% }"
		else
			printf '   %s·%s (no tenant services on %s)\n' "${C_DIM}" "${C_RESET}" "${NETWORK_NAME}"
		fi
	fi
	printf '   %s·%s remove overlay networks %s and %s\n' "${C_RED}" "${C_RESET}" "${NETWORK_NAME}" "${INTERNAL_NETWORK_NAME}"
	if [ "${PURGE}" = "1" ]; then
		printf '   %s·%s DELETE volume %s (the whole platform database)\n' "${C_RED}${C_BOLD}" "${C_RESET}" "${POSTGRES_VOLUME}"
		printf '   %s·%s DELETE %s (secrets, certificates, SSH keys, app checkouts)\n' "${C_RED}${C_BOLD}" "${C_RESET}" "${NIXPLOY_CONFIG_DIR}"
	else
		printf '   %s·%s KEEP volume %s and %s (re-run install.sh to restore)\n' "${C_GREEN}" "${C_RESET}" "${POSTGRES_VOLUME}" "${NIXPLOY_CONFIG_DIR}"
	fi
	if [ "${REMOVE_TENANTS}" != "1" ]; then
		printf '\n   %sTenant services and their volumes are left running (--tenants removes them).%s\n' "${C_DIM}" "${C_RESET}"
	fi
	printf '   %sDocker itself and the Swarm cluster are left alone.%s\n\n' "${C_DIM}" "${C_RESET}"
}

confirm() {
	if [ "${PURGE}" = "1" ]; then
		# --purge destroys the only copy of every tenant secret: always ask,
		# and require the phrase rather than a y/n a pipe could satisfy.
		[ -t 0 ] || die "--purge needs an interactive terminal (it asks you to type a confirmation phrase). Download the script and run it directly."
		printf '   Type %s%s%s to confirm: ' "${C_BOLD}" "${CONFIRM_PHRASE}" "${C_RESET}"
		local answer
		IFS= read -r answer
		[ "${answer}" = "${CONFIRM_PHRASE}" ] || die "Not confirmed — nothing was removed"
		return 0
	fi
	[ "${NIXPLOY_YES:-0}" = "1" ] && return 0
	[ -t 0 ] || die "Not an interactive terminal — re-run with NIXPLOY_YES=1 to proceed unattended"
	printf '   Continue? [y/N] '
	local answer
	IFS= read -r answer
	case "${answer}" in y|Y|yes|YES) return 0 ;; esac
	die "Cancelled — nothing was removed"
}

# ── removal ──────────────────────────────────────────────────────────────────
remove_services() {
	local service
	if [ "${REMOVE_TENANTS}" = "1" ]; then
		local tenant
		while IFS= read -r tenant; do
			[ -n "${tenant}" ] || continue
			docker service rm "${tenant}" >/dev/null 2>&1 && ok "Removed tenant service ${tenant}"
		done < <(tenant_services)
	fi
	for service in "${PLATFORM_SERVICES[@]}"; do
		docker service inspect "${service}" >/dev/null 2>&1 || continue
		if docker service rm "${service}" >/dev/null 2>&1; then
			ok "Removed service ${service}"
		else
			warn "Could not remove service ${service}"
		fi
	done
	# Swarm tears tasks down asynchronously; the networks below cannot be
	# removed while an endpoint still hangs off them.
	local waited=0
	while [ "${waited}" -lt 30 ]; do
		{
			docker ps --filter label=com.docker.swarm.service.name=nixploy --quiet 2>/dev/null
			docker ps --filter label=com.docker.swarm.service.name=nixploy-worker --quiet 2>/dev/null
		} | grep -q . || break
		sleep 1
		waited=$((waited + 1))
	done
}

remove_networks() {
	local network
	for network in "${NETWORK_NAME}" "${INTERNAL_NETWORK_NAME}"; do
		docker network inspect "${network}" >/dev/null 2>&1 || continue
		if docker network rm "${network}" >/dev/null 2>&1; then
			ok "Removed network ${network}"
		else
			warn "Could not remove network ${network} — a service or container is still attached (docker network inspect ${network})"
		fi
	done
}

purge_data() {
	[ "${PURGE}" = "1" ] || return 0
	if docker volume inspect "${POSTGRES_VOLUME}" >/dev/null 2>&1; then
		if docker volume rm "${POSTGRES_VOLUME}" >/dev/null 2>&1; then
			ok "Deleted volume ${POSTGRES_VOLUME}"
		else
			warn "Could not delete volume ${POSTGRES_VOLUME} — it is still in use"
		fi
	fi
	# Refuse obviously wrong targets: a typo'd NIXPLOY_CONFIG_DIR must never
	# turn this into `rm -rf /`.
	case "${NIXPLOY_CONFIG_DIR}" in
		""|"/"|"/etc"|"/var"|"/usr"|"/home"|"/root"|"/opt")
			die "Refusing to delete ${NIXPLOY_CONFIG_DIR:-<empty>} — set NIXPLOY_CONFIG_DIR to the real config directory"
			;;
	esac
	if [ -d "${NIXPLOY_CONFIG_DIR}" ]; then
		rm -rf "${NIXPLOY_CONFIG_DIR}"
		ok "Deleted ${NIXPLOY_CONFIG_DIR}"
	fi
}

print_summary() {
	printf '\n'
	printf '  %s╭──────────────────────────────────────────────╮%s\n' "${C_GREEN}" "${C_RESET}"
	printf '  %s│%s        %sNixploy has been removed%s              %s│%s\n' "${C_GREEN}" "${C_RESET}" "${C_BOLD}" "${C_RESET}" "${C_GREEN}" "${C_RESET}"
	printf '  %s╰──────────────────────────────────────────────╯%s\n' "${C_GREEN}" "${C_RESET}"
	printf '\n'
	if [ "${PURGE}" = "1" ]; then
		printf '   %sThe database volume and %s are gone.%s\n' "${C_DIM}" "${NIXPLOY_CONFIG_DIR}" "${C_RESET}"
	else
		printf '   %sKept:%s   %s and volume %s\n' "${C_DIM}" "${C_RESET}" "${NIXPLOY_CONFIG_DIR}" "${POSTGRES_VOLUME}"
		printf '   %sRestore: re-run install.sh on this host.%s\n' "${C_DIM}" "${C_RESET}"
		printf '   %sPurge:   %s --purge%s\n' "${C_DIM}" "$0" "${C_RESET}"
	fi
	printf '   %sImages are kept — reclaim them with: docker system prune -a%s\n' "${C_DIM}" "${C_RESET}"
	printf '   %sSwarm is still active — leave it with: docker swarm leave --force%s\n' "${C_DIM}" "${C_RESET}"
	printf '\n'
}

main() {
	require_root
	require_docker
	print_plan
	confirm
	remove_services
	remove_networks
	purge_data
	print_summary
}

main
