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
    image: postgres:17-alpine
    restart: always
    environment:
      POSTGRES_USER: authentik
      POSTGRES_DB: authentik
      POSTGRES_PASSWORD: \${PG_PASSWORD}
    volumes:
      - authentik-db:/var/lib/postgresql/data
  redis:
    image: redis:8-alpine
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
	{
		id: "zitadel",
		name: "ZITADEL",
		description:
			"Identity platform with OIDC, SAML, passkeys and multi-tenancy — an open-source Auth0 you run yourself.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/zitadel.svg",
		tags: ["sso", "identity", "oidc"],
		links: {
			website: "https://zitadel.com",
			github: "https://github.com/zitadel/zitadel",
			docs: "https://zitadel.com/docs",
		},
		suggestedDomain: { serviceName: "zitadel", port: 8080 },
		env: [
			{
				key: "ZITADEL_MASTERKEY",
				default: "",
				description:
					"Exactly 32 characters used to encrypt secrets at rest (`openssl rand -hex 16`)",
			},
			{
				key: "ZITADEL_EXTERNALDOMAIN",
				default: "localhost",
				description: "Hostname the instance is served on, without scheme or port",
			},
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the zitadel PostgreSQL user",
			},
		],
		compose: `services:
  zitadel:
    image: ghcr.io/zitadel/zitadel:latest
    restart: always
    depends_on:
      - zitadel_db
    command: start-from-init --masterkeyFromEnv --tlsMode external
    environment:
      ZITADEL_MASTERKEY: \${ZITADEL_MASTERKEY}
      ZITADEL_EXTERNALDOMAIN: \${ZITADEL_EXTERNALDOMAIN}
      ZITADEL_EXTERNALPORT: "443"
      ZITADEL_EXTERNALSECURE: "true"
      ZITADEL_PORT: "8080"
      ZITADEL_DATABASE_POSTGRES_HOST: zitadel_db
      ZITADEL_DATABASE_POSTGRES_PORT: "5432"
      ZITADEL_DATABASE_POSTGRES_DATABASE: zitadel
      ZITADEL_DATABASE_POSTGRES_USER_USERNAME: zitadel
      ZITADEL_DATABASE_POSTGRES_USER_PASSWORD: \${POSTGRES_PASSWORD}
      ZITADEL_DATABASE_POSTGRES_USER_SSL_MODE: disable
      ZITADEL_DATABASE_POSTGRES_ADMIN_USERNAME: postgres
      ZITADEL_DATABASE_POSTGRES_ADMIN_PASSWORD: \${POSTGRES_PASSWORD}
      ZITADEL_DATABASE_POSTGRES_ADMIN_SSL_MODE: disable
  zitadel_db:
    image: postgres:17-alpine
    restart: always
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: zitadel
    volumes:
      - zitadel-db:/var/lib/postgresql/data
volumes:
  zitadel-db:
`,
	},
	{
		id: "infisical",
		name: "Infisical",
		description:
			"Secret manager for teams — environments per project, versioned values, and SDKs or a CLI to inject them at runtime.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/infisical.svg",
		tags: ["secrets", "security"],
		links: {
			website: "https://infisical.com",
			github: "https://github.com/Infisical/infisical",
			docs: "https://infisical.com/docs/documentation/getting-started/introduction",
		},
		suggestedDomain: { serviceName: "infisical", port: 8080 },
		env: [
			{
				key: "SITE_URL",
				default: "http://localhost:8080",
				description: "Public URL of the instance (e.g. https://secrets.example.com)",
			},
			{
				key: "ENCRYPTION_KEY",
				default: "",
				description: "Exactly 32 hex characters used to encrypt secrets (`openssl rand -hex 16`)",
			},
			{
				key: "AUTH_SECRET",
				default: "",
				description: "Base64 signing secret for sessions (`openssl rand -base64 32`)",
			},
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the infisical PostgreSQL user",
			},
		],
		compose: `services:
  infisical:
    image: infisical/infisical:latest-postgres
    restart: always
    depends_on:
      - infisical_db
      - infisical_redis
    environment:
      SITE_URL: \${SITE_URL}
      ENCRYPTION_KEY: \${ENCRYPTION_KEY}
      AUTH_SECRET: \${AUTH_SECRET}
      DB_CONNECTION_URI: postgres://infisical:\${POSTGRES_PASSWORD}@infisical_db:5432/infisical
      REDIS_URL: redis://infisical_redis:6379
  infisical_db:
    image: postgres:17-alpine
    restart: always
    environment:
      POSTGRES_USER: infisical
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: infisical
    volumes:
      - infisical-db:/var/lib/postgresql/data
  infisical_redis:
    image: redis:8-alpine
    restart: always
    volumes:
      - infisical-redis:/data
volumes:
  infisical-db:
  infisical-redis:
`,
	},
	{
		id: "passbolt",
		name: "Passbolt",
		description:
			"Team password manager built on OpenPGP — shared folders, per-secret permissions and a browser extension.",
		logo: "passbolt",
		tags: ["passwords", "security", "team"],
		links: {
			website: "https://www.passbolt.com",
			github: "https://github.com/passbolt/passbolt_api",
			docs: "https://www.passbolt.com/docs",
		},
		suggestedDomain: { serviceName: "passbolt", port: 80 },
		env: [
			{
				key: "APP_FULL_BASE_URL",
				default: "https://passbolt.example.com",
				description: "Public HTTPS URL — Passbolt refuses to register users without it",
			},
			{
				key: "MYSQL_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the passbolt MySQL user",
			},
			{
				key: "MYSQL_ROOT_PASSWORD",
				default: "{{generateSecret}}",
				description: "MariaDB root password",
			},
		],
		compose: `services:
  passbolt:
    image: passbolt/passbolt:latest-ce
    restart: always
    depends_on:
      - passbolt_db
    environment:
      APP_FULL_BASE_URL: \${APP_FULL_BASE_URL}
      DATASOURCES_DEFAULT_HOST: passbolt_db
      DATASOURCES_DEFAULT_DATABASE: passbolt
      DATASOURCES_DEFAULT_USERNAME: passbolt
      DATASOURCES_DEFAULT_PASSWORD: \${MYSQL_PASSWORD}
    volumes:
      - passbolt-gpg:/etc/passbolt/gpg
      - passbolt-jwt:/etc/passbolt/jwt
  passbolt_db:
    image: mariadb:11.8
    restart: always
    environment:
      MYSQL_DATABASE: passbolt
      MYSQL_USER: passbolt
      MYSQL_PASSWORD: \${MYSQL_PASSWORD}
      MYSQL_ROOT_PASSWORD: \${MYSQL_ROOT_PASSWORD}
    volumes:
      - passbolt-db:/var/lib/mysql
volumes:
  passbolt-gpg:
  passbolt-jwt:
  passbolt-db:
`,
	},
];
