import type { TemplateData } from "../types";

export const toolTemplates: TemplateData[] = [
	{
		id: "mealie",
		name: "Mealie",
		description:
			"Self-hosted recipe manager and meal planner — import recipes from any URL, plan your week and build shopping lists.",
		logo: "mealie",
		tags: ["recipes", "food", "home"],
		links: {
			website: "https://mealie.io",
			github: "https://github.com/mealie-recipes/mealie",
			docs: "https://docs.mealie.io",
		},
		suggestedDomain: { serviceName: "mealie", port: 9000 },
		env: [
			{
				key: "BASE_URL",
				default: "http://localhost:9000",
				description: "Public URL of the instance (e.g. https://recipes.example.com)",
			},
			{
				key: "ALLOW_SIGNUP",
				default: "false",
				description: "Allow new users to register (true/false)",
			},
		],
		compose: `services:
  mealie:
    image: ghcr.io/mealie-recipes/mealie:v3.26.0
    restart: always
    environment:
      BASE_URL: \${BASE_URL}
      ALLOW_SIGNUP: \${ALLOW_SIGNUP}
      DB_ENGINE: sqlite
    volumes:
      - mealie-data:/app/data
volumes:
  mealie-data:
`,
	},
	{
		id: "shlink",
		name: "Shlink",
		description:
			"Self-hosted URL shortener — create short links with visit tracking, custom slugs and a REST API.",
		logo: "bitly",
		tags: ["url-shortener", "links", "tools"],
		links: {
			website: "https://shlink.io",
			github: "https://github.com/shlinkio/shlink",
			docs: "https://shlink.io/documentation",
		},
		suggestedDomain: { serviceName: "shlink", port: 8080 },
		env: [
			{
				key: "DEFAULT_DOMAIN",
				default: "localhost:8080",
				description: "Domain used to build short URLs (e.g. s.example.com)",
			},
			{
				key: "INITIAL_API_KEY",
				default: "{{generateSecret}}",
				description: "Initial API key created on first run (used by the Shlink web client)",
			},
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the shlink PostgreSQL user",
			},
		],
		compose: `services:
  shlink:
    image: shlinkio/shlink:4
    restart: always
    depends_on:
      - shlink_db
    environment:
      DEFAULT_DOMAIN: \${DEFAULT_DOMAIN}
      IS_HTTPS_ENABLED: "false"
      INITIAL_API_KEY: \${INITIAL_API_KEY}
      DB_DRIVER: postgres
      DB_HOST: shlink_db
      DB_PORT: "5432"
      DB_USER: shlink
      DB_PASSWORD: \${POSTGRES_PASSWORD}
      DB_NAME: shlink
  shlink_db:
    image: postgres:17-alpine
    restart: always
    environment:
      POSTGRES_USER: shlink
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: shlink
    volumes:
      - shlink-db-data:/var/lib/postgresql/data
volumes:
  shlink-db-data:
`,
	},
	{
		id: "sonarqube",
		name: "SonarQube",
		description:
			"Continuous code quality and security inspection — static analysis for 30+ languages with quality gates.",
		logo: "sonarqubeserver",
		tags: ["dev-tools", "code-quality", "ci"],
		links: {
			website: "https://www.sonarsource.com/products/sonarqube",
			docs: "https://docs.sonarqube.org",
		},
		suggestedDomain: { serviceName: "sonarqube", port: 9000 },
		env: [],
		compose: `services:
  sonarqube:
    image: sonarqube:community
    restart: always
    volumes:
      - sonarqube-data:/opt/sonarqube/data
      - sonarqube-extensions:/opt/sonarqube/extensions
volumes:
  sonarqube-data:
  sonarqube-extensions:
`,
	},
	{
		id: "docker-registry",
		name: "Docker Registry",
		description: "Private container image registry — store and distribute your own Docker images.",
		logo: "docker",
		tags: ["dev-tools", "docker", "registry"],
		links: {
			github: "https://github.com/distribution/distribution",
			docs: "https://distribution.github.io/distribution",
		},
		suggestedDomain: { serviceName: "registry", port: 5000 },
		env: [],
		compose: `services:
  registry:
    image: registry:2
    restart: always
    environment:
      REGISTRY_STORAGE_DELETE_ENABLED: "true"
    volumes:
      - registry-data:/var/lib/registry
volumes:
  registry-data:
`,
	},
	{
		id: "meilisearch",
		name: "Meilisearch",
		description:
			"Lightning-fast, typo-tolerant search engine with an instant search experience and simple REST API.",
		logo: "meilisearch",
		tags: ["dev-tools", "search", "api"],
		links: {
			website: "https://www.meilisearch.com",
			github: "https://github.com/meilisearch/meilisearch",
			docs: "https://www.meilisearch.com/docs",
		},
		suggestedDomain: { serviceName: "meilisearch", port: 7700 },
		env: [
			{
				key: "MEILI_MASTER_KEY",
				default: "{{generateSecret}}",
				description: "Master key protecting the API",
			},
		],
		compose: `services:
  meilisearch:
    image: getmeili/meilisearch:v1
    restart: always
    environment:
      MEILI_ENV: production
      MEILI_MASTER_KEY: \${MEILI_MASTER_KEY}
    volumes:
      - meili-data:/meili_data
volumes:
  meili-data:
`,
	},
	{
		id: "it-tools",
		name: "IT Tools",
		description:
			"Handy collection of online tools for developers — converters, encoders, generators and formatters.",
		logo: "https://raw.githubusercontent.com/CorentinTh/it-tools/main/public/android-chrome-192x192.png",
		tags: ["dev-tools", "utilities"],
		links: {
			github: "https://github.com/CorentinTh/it-tools",
		},
		suggestedDomain: { serviceName: "it-tools", port: 80 },
		env: [],
		compose: `services:
  it-tools:
    image: corentinth/it-tools:latest
    restart: always
`,
	},
	{
		id: "excalidraw",
		name: "Excalidraw",
		description:
			"Virtual whiteboard for sketching hand-drawn-like diagrams — fast, minimal, collaborative.",
		logo: "excalidraw",
		tags: ["dev-tools", "diagrams", "whiteboard"],
		links: {
			website: "https://excalidraw.com",
			github: "https://github.com/excalidraw/excalidraw",
		},
		suggestedDomain: { serviceName: "excalidraw", port: 80 },
		env: [],
		compose: `services:
  excalidraw:
    image: excalidraw/excalidraw:latest
    restart: always
`,
	},
	{
		id: "drawio",
		name: "draw.io",
		description:
			"Full-featured diagramming — flowcharts, network diagrams, UML and BPMN, saved wherever you like.",
		logo: "diagramsdotnet",
		tags: ["dev-tools", "diagrams"],
		links: {
			website: "https://www.drawio.com",
			github: "https://github.com/jgraph/drawio",
		},
		suggestedDomain: { serviceName: "drawio", port: 8080 },
		env: [],
		compose: `services:
  drawio:
    image: jgraph/drawio:latest
    restart: always
`,
	},
	{
		id: "hoppscotch",
		name: "Hoppscotch",
		description:
			"Open-source API development ecosystem — a fast Postman alternative for REST, GraphQL and WebSockets.",
		logo: "hoppscotch",
		tags: ["dev-tools", "api", "testing"],
		links: {
			website: "https://hoppscotch.io",
			github: "https://github.com/hoppscotch/hoppscotch",
			docs: "https://docs.hoppscotch.io",
		},
		suggestedDomain: { serviceName: "hoppscotch", port: 3000 },
		env: [],
		compose: `services:
  hoppscotch:
    image: hoppscotch/hoppscotch:latest
    restart: always
`,
	},
	{
		id: "searxng",
		name: "SearXNG",
		description:
			"Meta search engine that queries other engines for you and forwards no profile — no cookies, no tracking, your own instance.",
		logo: "searxng",
		tags: ["search", "privacy"],
		links: {
			website: "https://docs.searxng.org",
			github: "https://github.com/searxng/searxng",
			docs: "https://docs.searxng.org/admin/installation-docker.html",
		},
		suggestedDomain: { serviceName: "searxng", port: 8080 },
		env: [
			{
				key: "SEARXNG_BASE_URL",
				default: "http://localhost:8080/",
				description: "Public URL of the instance, with a trailing slash",
			},
			{
				key: "SEARXNG_SECRET",
				default: "{{generateSecret}}",
				description: "Signs the search cookies",
			},
		],
		compose: `services:
  searxng:
    image: searxng/searxng:latest
    restart: always
    environment:
      SEARXNG_BASE_URL: \${SEARXNG_BASE_URL}
      SEARXNG_SECRET: \${SEARXNG_SECRET}
    volumes:
      - searxng-config:/etc/searxng
volumes:
  searxng-config:
`,
	},
	{
		id: "cyberchef",
		name: "CyberChef",
		description:
			"The cyber swiss army knife — encode, decode, hash, parse and diff data through a chain of operations, entirely in the browser.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/cyberchef.svg",
		tags: ["tools", "encoding", "security"],
		links: {
			website: "https://gchq.github.io/CyberChef/",
			github: "https://github.com/gchq/CyberChef",
			docs: "https://github.com/gchq/CyberChef/wiki",
		},
		suggestedDomain: { serviceName: "cyberchef", port: 80 },
		env: [],
		compose: `services:
  cyberchef:
    image: ghcr.io/gchq/cyberchef:latest
    restart: always
`,
	},
	{
		id: "linkding",
		name: "linkding",
		description:
			"Fast, plain bookmark manager — tags, bulk edit, full-text search over saved snapshots and a browser extension.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/linkding.svg",
		tags: ["bookmarks", "read-later"],
		links: {
			website: "https://linkding.link",
			github: "https://github.com/sissbruecker/linkding",
			docs: "https://linkding.link/installation/",
		},
		suggestedDomain: { serviceName: "linkding", port: 9090 },
		env: [
			{
				key: "LD_SUPERUSER_NAME",
				default: "admin",
				description: "Username of the account created on first boot",
			},
			{
				key: "LD_SUPERUSER_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of that account",
			},
		],
		compose: `services:
  linkding:
    image: sissbruecker/linkding:latest
    restart: always
    environment:
      LD_SUPERUSER_NAME: \${LD_SUPERUSER_NAME}
      LD_SUPERUSER_PASSWORD: \${LD_SUPERUSER_PASSWORD}
    volumes:
      - linkding-data:/etc/linkding/data
volumes:
  linkding-data:
`,
	},
	{
		id: "privatebin",
		name: "PrivateBin",
		description:
			"Zero-knowledge pastebin — the server stores ciphertext it cannot read, with burn-after-reading and expiry.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/privatebin.svg",
		tags: ["paste", "privacy", "sharing"],
		links: {
			website: "https://privatebin.info",
			github: "https://github.com/PrivateBin/PrivateBin",
			docs: "https://github.com/PrivateBin/PrivateBin/wiki",
		},
		suggestedDomain: { serviceName: "privatebin", port: 8080 },
		env: [],
		compose: `services:
  privatebin:
    image: privatebin/nginx-fpm-alpine:latest
    restart: always
    volumes:
      - privatebin-data:/srv/data
volumes:
  privatebin-data:
`,
	},
	{
		id: "verdaccio",
		name: "Verdaccio",
		description:
			"Private npm registry that proxies the public one — publish internal packages and cache everything else.",
		logo: "verdaccio",
		tags: ["registry", "npm", "developer"],
		links: {
			website: "https://verdaccio.org",
			github: "https://github.com/verdaccio/verdaccio",
			docs: "https://verdaccio.org/docs/what-is-verdaccio",
		},
		suggestedDomain: { serviceName: "verdaccio", port: 4873 },
		env: [],
		compose: `services:
  verdaccio:
    image: verdaccio/verdaccio:6
    restart: always
    environment:
      VERDACCIO_PORT: "4873"
    volumes:
      - verdaccio-storage:/verdaccio/storage
      - verdaccio-config:/verdaccio/conf
volumes:
  verdaccio-storage:
  verdaccio-config:
`,
	},
	{
		id: "jenkins",
		name: "Jenkins",
		description:
			"The automation server everyone has met — pipelines as code, thousands of plugins and agents for anything you can script.",
		logo: "jenkins",
		tags: ["ci", "automation", "developer"],
		links: {
			website: "https://www.jenkins.io",
			github: "https://github.com/jenkinsci/jenkins",
			docs: "https://www.jenkins.io/doc/",
		},
		suggestedDomain: { serviceName: "jenkins", port: 8080 },
		env: [],
		compose: `services:
  jenkins:
    image: jenkins/jenkins:lts-jdk21
    restart: always
    environment:
      JAVA_OPTS: -Djenkins.install.runSetupWizard=true
    volumes:
      - jenkins-home:/var/jenkins_home
volumes:
  jenkins-home:
`,
	},
	{
		id: "docuseal",
		name: "DocuSeal",
		description:
			"Document signing you host — build a form on a PDF, send it for signature, keep the audit trail and the files.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/docuseal.svg",
		tags: ["documents", "signing", "pdf"],
		links: {
			website: "https://www.docuseal.com",
			github: "https://github.com/docusealco/docuseal",
			docs: "https://www.docuseal.com/docs",
		},
		suggestedDomain: { serviceName: "docuseal", port: 3000 },
		env: [
			{
				key: "SECRET_KEY_BASE",
				default: "{{generateSecret}}",
				description: "Rails session secret — changing it signs everyone out",
			},
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the docuseal PostgreSQL user",
			},
		],
		compose: `services:
  docuseal:
    image: docuseal/docuseal:latest
    restart: always
    depends_on:
      - docuseal_db
    environment:
      FORCE_SSL: "false"
      SECRET_KEY_BASE: \${SECRET_KEY_BASE}
      DATABASE_URL: postgresql://docuseal:\${POSTGRES_PASSWORD}@docuseal_db:5432/docuseal
    volumes:
      - docuseal-data:/data
  docuseal_db:
    image: postgres:17-alpine
    restart: always
    environment:
      POSTGRES_USER: docuseal
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: docuseal
    volumes:
      - docuseal-db:/var/lib/postgresql/data
volumes:
  docuseal-data:
  docuseal-db:
`,
	},
	{
		id: "kutt",
		name: "Kutt",
		description:
			"URL shortener with custom domains, password-protected links, expiry and per-link click statistics.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/png/kutt.png",
		tags: ["url-shortener", "links"],
		links: {
			website: "https://kutt.it",
			github: "https://github.com/thedevs-network/kutt",
			docs: "https://github.com/thedevs-network/kutt#readme",
		},
		suggestedDomain: { serviceName: "kutt", port: 3000 },
		env: [
			{
				key: "DEFAULT_DOMAIN",
				default: "localhost:3000",
				description: "Hostname the short links are built from",
			},
			{
				key: "JWT_SECRET",
				default: "{{generateSecret}}",
				description: "Signs API tokens",
			},
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the kutt PostgreSQL user",
			},
		],
		compose: `services:
  kutt:
    image: kutt/kutt:latest
    restart: always
    depends_on:
      - kutt_db
      - kutt_redis
    environment:
      DEFAULT_DOMAIN: \${DEFAULT_DOMAIN}
      JWT_SECRET: \${JWT_SECRET}
      DB_HOST: kutt_db
      DB_PORT: "5432"
      DB_NAME: kutt
      DB_USER: kutt
      DB_PASSWORD: \${POSTGRES_PASSWORD}
      REDIS_HOST: kutt_redis
      REDIS_PORT: "6379"
    volumes:
      - kutt-data:/var/lib/kutt
  kutt_db:
    image: postgres:17-alpine
    restart: always
    environment:
      POSTGRES_USER: kutt
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: kutt
    volumes:
      - kutt-db:/var/lib/postgresql/data
  kutt_redis:
    image: redis:8-alpine
    restart: always
    volumes:
      - kutt-redis:/data
volumes:
  kutt-data:
  kutt-db:
  kutt-redis:
`,
	},
	{
		id: "openhole",
		name: "OpenHole",
		description:
			"Self-hosted tunnel edge — gives any local port a public HTTPS URL with one command. This runs the server; the openhole CLI connects to it.",
		logo: "https://openhole.dev/icon-transparent.png",
		tags: ["tunnel", "localhost", "webhooks"],
		links: {
			website: "https://openhole.dev",
			github: "https://github.com/bablilayoub/openhole",
			docs: "https://openhole.dev/docs/self-hosting",
		},
		suggestedDomain: { serviceName: "openhole", port: 8080 },
		// Verified against the OpenHole source (internal/server/config.go,
		// host.go) and openhole.dev/docs/self-hosting on 2026-09-20: the server
		// routes by Host header — the endpoint host serves /tunnel and /health,
		// `<sub>.<tunnel domain>` is proxied to that tunnel — so it needs two
		// hostnames, one of them a wildcard, and it listens on plain 8080
		// behind a reverse proxy that sets X-Forwarded-For.
		setup: [
			"Before deploying, set the two hostnames: `TUNNEL_ENDPOINT_HOST` is what the CLI connects to (for example `tunnel.example.com`) and `PUBLIC_TUNNEL_DOMAIN` is the zone tunnels are served under (for example `tunnels.example.com`). Keep the generated `REGISTRATION_TOKENS` or paste your own comma-separated list — empty means anyone can open a tunnel on your server.",
			"DNS, all pointing at this server and DNS-only (a proxied record breaks tunnel routing): an A record for the endpoint host, and a wildcard A record `*.<tunnel domain>`. Shortcut: make the endpoint host a name under the tunnel domain (`tunnel.tunnels.example.com`) and the wildcard record covers both.",
			"Domains tab of this service: add the endpoint host with HTTPS (Let's Encrypt), then add `*.<tunnel domain>` as a second domain. A wildcard domain is instance-admin only and its certificate needs a DNS-01 provider under Settings → Web server — HTTP-01 cannot validate a wildcard. WebSocket upgrades pass through Traefik as-is.",
			"Install the CLI on your machine (`curl -fsSL https://openhole.dev/install.sh | sh`) and open a tunnel: `openhole 3000 --server wss://<endpoint host>/tunnel --token <one of REGISTRATION_TOKENS>`; add `--subdomain myapp` for a stable name. The public URL is `https://<sub>.<tunnel domain>`.",
			'Check `https://<endpoint host>/health` answers `{"status":"ok"}`. Port 8080 is never published; Traefik is the only way in, which is why `TRUST_PROXY_HEADERS` is on — never expose 8080 directly with it set.',
		],
		env: [
			{
				key: "TUNNEL_ENDPOINT_HOST",
				default: "tunnel.example.com",
				description:
					"Hostname the CLI connects to (wss://<host>/tunnel) — add it as this service's domain",
			},
			{
				key: "PUBLIC_TUNNEL_DOMAIN",
				default: "tunnels.example.com",
				description:
					"Domain the tunnels are served under — add *.<domain> as a second domain on this service (a wildcard needs a DNS-01 provider in Settings → Web server)",
			},
			{
				key: "REGISTRATION_TOKENS",
				default: "{{generateSecret}}",
				description:
					"Comma-separated tokens the CLI must pass with --token; leave empty to let anyone open a tunnel",
			},
		],
		compose: `services:
  openhole:
    image: ghcr.io/bablilayoub/openhole-server:main
    restart: always
    environment:
      PUBLIC_TUNNEL_DOMAIN: \${PUBLIC_TUNNEL_DOMAIN}
      TUNNEL_ENDPOINT_HOST: \${TUNNEL_ENDPOINT_HOST}
      REGISTRATION_TOKENS: \${REGISTRATION_TOKENS}
      SERVER_PORT: "8080"
      PUBLIC_URL_SCHEME: https
      TRUST_PROXY_HEADERS: "true"
      SUBDOMAIN_HOLD_SECONDS: "300"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/health"]
      interval: 10s
      timeout: 3s
      retries: 5
`,
	},
];
