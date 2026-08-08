import type { TemplateData } from "../types";

/** `${...}` sequences are escaped so the compose bodies keep them verbatim. */

export const securityTemplates: TemplateData[] = [
	{
		id: "keycloak",
		name: "Keycloak",
		description:
			"Open-source identity and access management — SSO, OIDC/SAML, social login and user federation.",
		logo: "keycloak",
		tags: ["auth", "sso", "oidc"],
		links: {
			website: "https://www.keycloak.org",
			github: "https://github.com/keycloak/keycloak",
			docs: "https://www.keycloak.org/documentation",
		},
		suggestedDomain: { serviceName: "keycloak", port: 8080 },
		env: [
			{
				key: "KEYCLOAK_ADMIN",
				default: "admin",
				description: "Initial admin username",
			},
			{
				key: "KEYCLOAK_ADMIN_PASSWORD",
				default: "{{generateSecret}}",
				description: "Initial admin password",
			},
		],
		compose: `services:
  keycloak:
    image: keycloak/keycloak:latest
    restart: always
    command: start-dev
    environment:
      KEYCLOAK_ADMIN: \${KEYCLOAK_ADMIN}
      KEYCLOAK_ADMIN_PASSWORD: \${KEYCLOAK_ADMIN_PASSWORD}
    volumes:
      - keycloak-data:/opt/keycloak/data
volumes:
  keycloak-data:
`,
	},
	{
		id: "authentik",
		name: "Authentik",
		description:
			"Identity provider focused on flexibility — SSO, MFA and enrollment flows for all your self-hosted apps.",
		logo: "authentik",
		tags: ["auth", "sso", "oidc"],
		links: {
			website: "https://goauthentik.io",
			github: "https://github.com/goauthentik/authentik",
			docs: "https://docs.goauthentik.io",
		},
		suggestedDomain: { serviceName: "server", port: 9000 },
		env: [
			{
				key: "AUTHENTIK_SECRET_KEY",
				default: "{{generateSecret}}",
				description: "Secret key used for signing and encryption",
			},
			{
				key: "PG_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the bundled PostgreSQL database",
			},
		],
		compose: `services:
  postgresql:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: authentik
      POSTGRES_DB: authentik
      POSTGRES_PASSWORD: \${PG_PASSWORD}
    volumes:
      - authentik-db:/var/lib/postgresql/data
  redis:
    image: redis:7-alpine
    restart: always
  server:
    image: ghcr.io/goauthentik/server:latest
    restart: always
    command: server
    depends_on:
      - postgresql
      - redis
    environment:
      AUTHENTIK_SECRET_KEY: \${AUTHENTIK_SECRET_KEY}
      AUTHENTIK_POSTGRESQL__HOST: postgresql
      AUTHENTIK_POSTGRESQL__USER: authentik
      AUTHENTIK_POSTGRESQL__NAME: authentik
      AUTHENTIK_POSTGRESQL__PASSWORD: \${PG_PASSWORD}
      AUTHENTIK_REDIS__HOST: redis
    volumes:
      - authentik-media:/media
      - authentik-templates:/templates
  worker:
    image: ghcr.io/goauthentik/server:latest
    restart: always
    command: worker
    depends_on:
      - postgresql
      - redis
    environment:
      AUTHENTIK_SECRET_KEY: \${AUTHENTIK_SECRET_KEY}
      AUTHENTIK_POSTGRESQL__HOST: postgresql
      AUTHENTIK_POSTGRESQL__USER: authentik
      AUTHENTIK_POSTGRESQL__NAME: authentik
      AUTHENTIK_POSTGRESQL__PASSWORD: \${PG_PASSWORD}
      AUTHENTIK_REDIS__HOST: redis
    volumes:
      - authentik-media:/media
      - authentik-templates:/templates
volumes:
  authentik-db:
  authentik-media:
  authentik-templates:
`,
	},
	{
		id: "adguard-home",
		name: "AdGuard Home",
		description:
			"Network-wide ad and tracker blocking DNS server — first-run setup wizard listens on port 3000.",
		logo: "adguard",
		tags: ["dns", "privacy", "ad-blocking"],
		links: {
			website: "https://adguard.com/en/adguard-home/overview.html",
			github: "https://github.com/AdguardTeam/AdGuardHome",
			docs: "https://adguard.com/kb",
		},
		suggestedDomain: { serviceName: "adguard-home", port: 3000 },
		env: [],
		compose: `services:
  adguard-home:
    image: adguard/adguardhome:latest
    restart: always
    volumes:
      - adguard-work:/opt/adguardhome/work
      - adguard-conf:/opt/adguardhome/conf
volumes:
  adguard-work:
  adguard-conf:
`,
	},
	{
		id: "wg-easy",
		name: "WireGuard Easy",
		description:
			"The easiest way to run WireGuard VPN — web UI for clients, QR codes and stats. Requires instance admin (NET_ADMIN / SYS_MODULE).",
		logo: "wireguard",
		tags: ["vpn", "network", "privacy", "privileged"],
		hostPrivileged: true,
		links: {
			github: "https://github.com/wg-easy/wg-easy",
			docs: "https://github.com/wg-easy/wg-easy",
		},
		suggestedDomain: { serviceName: "wg-easy", port: 51821 },
		env: [
			{
				key: "WG_HOST",
				default: "vpn.example.com",
				description: "Public hostname or IP clients connect to",
			},
			{
				key: "PASSWORD_HASH",
				default: "{{generateSecret}}",
				description: "Bcrypt hash of the web UI password (see wg-easy docs)",
			},
		],
		compose: `services:
  wg-easy:
    image: ghcr.io/wg-easy/wg-easy:latest
    restart: always
    environment:
      WG_HOST: \${WG_HOST}
      PASSWORD_HASH: \${PASSWORD_HASH}
      LANG: en
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
    sysctls:
      - net.ipv4.ip_forward=1
      - net.ipv4.conf.all.src_valid_mark=1
    volumes:
      - wg-easy-data:/etc/wireguard
volumes:
  wg-easy-data:
`,
	},
	{
		id: "nginx-proxy-manager",
		name: "Nginx Proxy Manager",
		description:
			"Manage reverse proxies and SSL certificates through a friendly UI. Publish ports 80/443 on the service when used as the edge proxy.",
		logo: "nginx",
		tags: ["proxy", "ssl", "network"],
		links: {
			website: "https://nginxproxymanager.com",
			github: "https://github.com/NginxProxyManager/nginx-proxy-manager",
			docs: "https://nginxproxymanager.com/guide",
		},
		suggestedDomain: { serviceName: "nginx-proxy-manager", port: 81 },
		env: [],
		compose: `services:
  nginx-proxy-manager:
    image: jc21/nginx-proxy-manager:latest
    restart: always
    volumes:
      - npm-data:/data
      - npm-letsencrypt:/etc/letsencrypt
volumes:
  npm-data:
  npm-letsencrypt:
`,
	},
	{
		id: "pihole",
		name: "Pi-hole",
		description:
			"Network-wide ad blocking via DNS sinkhole — dashboards, query logs and per-client policies.",
		logo: "pihole",
		tags: ["dns", "privacy", "ad-blocking"],
		links: {
			website: "https://pi-hole.net",
			github: "https://github.com/pi-hole/pi-hole",
			docs: "https://docs.pi-hole.net",
		},
		suggestedDomain: { serviceName: "pihole", port: 80 },
		env: [
			{
				key: "FTLCONF_WEBSERVER_API_PASSWORD",
				default: "{{generateSecret}}",
				description: "Web admin password",
			},
		],
		compose: `services:
  pihole:
    image: pihole/pihole:latest
    restart: always
    environment:
      FTLCONF_WEBSERVER_API_PASSWORD: \${FTLCONF_WEBSERVER_API_PASSWORD}
      TZ: UTC
    volumes:
      - pihole-etc:/etc/pihole
volumes:
  pihole-etc:
`,
	},
];
