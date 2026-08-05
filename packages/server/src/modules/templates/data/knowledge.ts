import type { TemplateData } from "../types";

export const knowledgeTemplates: TemplateData[] = [
	{
		id: "outline",
		name: "Outline",
		description:
			"Fast, collaborative knowledge base and wiki for teams — beautiful docs with Markdown, search and sharing.",
		logo: "outline",
		tags: ["wiki", "docs", "knowledge"],
		links: {
			website: "https://www.getoutline.com",
			github: "https://github.com/outline/outline",
			docs: "https://docs.getoutline.com/s/guide",
		},
		suggestedDomain: { serviceName: "outline", port: 3000 },
		env: [
			{
				key: "URL",
				default: "http://localhost:3000",
				description: "Public URL of the instance (e.g. https://wiki.example.com)",
			},
			{
				key: "SECRET_KEY",
				default: "{{generateSecret}}",
				description: "Secret used to sign sessions (hex string)",
			},
			{
				key: "UTILS_SECRET",
				default: "{{generateSecret}}",
				description: "Secret used for internal utility tokens (hex string)",
			},
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the outline PostgreSQL user",
			},
			{
				key: "OIDC_CLIENT_ID",
				default: "",
				description: "OAuth/OIDC client id (Outline requires an OIDC provider to log in)",
			},
			{
				key: "OIDC_CLIENT_SECRET",
				default: "",
				description: "OAuth/OIDC client secret",
			},
			{
				key: "OIDC_AUTH_URI",
				default: "",
				description: "OIDC authorization endpoint (e.g. https://auth.example.com/authorize)",
			},
			{
				key: "OIDC_TOKEN_URI",
				default: "",
				description: "OIDC token endpoint",
			},
			{
				key: "OIDC_USERINFO_URI",
				default: "",
				description: "OIDC userinfo endpoint",
			},
		],
		compose: `services:
  outline:
    image: outlinewiki/outline:latest
    restart: always
    depends_on:
      - outline_db
      - outline_redis
    environment:
      URL: \${URL}
      PORT: "3000"
      SECRET_KEY: \${SECRET_KEY}
      UTILS_SECRET: \${UTILS_SECRET}
      DATABASE_URL: postgres://outline:\${POSTGRES_PASSWORD}@outline_db:5432/outline
      REDIS_URL: redis://outline_redis:6379
      FILE_STORAGE: local
      FILE_STORAGE_LOCAL_ROOT_DIR: /var/lib/outline/data
      OIDC_CLIENT_ID: \${OIDC_CLIENT_ID}
      OIDC_CLIENT_SECRET: \${OIDC_CLIENT_SECRET}
      OIDC_AUTH_URI: \${OIDC_AUTH_URI}
      OIDC_TOKEN_URI: \${OIDC_TOKEN_URI}
      OIDC_USERINFO_URI: \${OIDC_USERINFO_URI}
      OIDC_DISPLAY_NAME: SSO
    volumes:
      - outline-data:/var/lib/outline/data
  outline_db:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: outline
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: outline
    volumes:
      - outline-db-data:/var/lib/postgresql/data
  outline_redis:
    image: redis:7-alpine
    restart: always
    volumes:
      - outline-redis-data:/data
volumes:
  outline-data:
  outline-db-data:
  outline-redis-data:
`,
	},
	{
		id: "wallabag",
		name: "Wallabag",
		description:
			"Self-hosted read-it-later app — save articles, strip the clutter and read them anywhere, online or off.",
		logo: "wallabag",
		tags: ["reading", "bookmarks", "knowledge"],
		links: {
			website: "https://www.wallabag.org",
			github: "https://github.com/wallabag/wallabag",
			docs: "https://doc.wallabag.org",
		},
		suggestedDomain: { serviceName: "wallabag", port: 80 },
		env: [
			{
				key: "DOMAIN_NAME",
				default: "http://localhost",
				description: "Public URL of the instance (e.g. https://read.example.com)",
			},
		],
		compose: `services:
  wallabag:
    image: wallabag/wallabag:2.6.14
    restart: always
    environment:
      SYMFONY__ENV__DOMAIN_NAME: \${DOMAIN_NAME}
      SYMFONY__ENV__FOSUSER_REGISTRATION: "true"
      SYMFONY__ENV__FOSUSER_CONFIRMATION: "false"
    volumes:
      - wallabag-data:/var/www/wallabag/data
      - wallabag-images:/var/www/wallabag/web/assets/images
volumes:
  wallabag-data:
  wallabag-images:
`,
	},
	{
		id: "linkwarden",
		name: "Linkwarden",
		description:
			"Collaborative bookmark manager — collect, organize and archive webpages as screenshots, PDFs and more.",
		logo: "pinboard",
		tags: ["bookmarks", "archiving", "knowledge"],
		links: {
			website: "https://linkwarden.app",
			github: "https://github.com/linkwarden/linkwarden",
			docs: "https://docs.linkwarden.app",
		},
		suggestedDomain: { serviceName: "linkwarden", port: 3000 },
		env: [
			{
				key: "NEXTAUTH_URL",
				default: "http://localhost:3000",
				description: "Public URL of the instance (e.g. https://links.example.com)",
			},
			{
				key: "NEXTAUTH_SECRET",
				default: "{{generateSecret}}",
				description: "Secret used to encrypt JWTs and sign emails",
			},
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the linkwarden PostgreSQL user",
			},
		],
		compose: `services:
  linkwarden:
    image: ghcr.io/linkwarden/linkwarden:v2.9.3
    restart: always
    depends_on:
      - linkwarden_db
    environment:
      NEXTAUTH_URL: \${NEXTAUTH_URL}
      NEXTAUTH_SECRET: \${NEXTAUTH_SECRET}
      DATABASE_URL: postgresql://linkwarden:\${POSTGRES_PASSWORD}@linkwarden_db:5432/linkwarden
    volumes:
      - linkwarden-data:/data
  linkwarden_db:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: linkwarden
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: linkwarden
    volumes:
      - linkwarden-db-data:/var/lib/postgresql/data
volumes:
  linkwarden-data:
  linkwarden-db-data:
`,
	},
	{
		id: "karakeep",
		name: "Karakeep",
		description:
			"AI-assisted bookmark-everything app — save links, notes and images with automatic tagging and full-text search.",
		logo: "karakeep",
		tags: ["bookmarks", "ai", "knowledge"],
		links: {
			website: "https://karakeep.app",
			github: "https://github.com/karakeep-app/karakeep",
			docs: "https://docs.karakeep.app",
		},
		suggestedDomain: { serviceName: "karakeep", port: 3000 },
		env: [
			{
				key: "NEXTAUTH_URL",
				default: "http://localhost:3000",
				description: "Public URL of the instance (e.g. https://keep.example.com)",
			},
			{
				key: "NEXTAUTH_SECRET",
				default: "{{generateSecret}}",
				description: "Secret used to encrypt JWTs",
			},
			{
				key: "MEILI_MASTER_KEY",
				default: "{{generateSecret}}",
				description: "Master key shared with the Meilisearch service",
			},
		],
		compose: `services:
  karakeep:
    image: ghcr.io/karakeep-app/karakeep:release
    restart: always
    depends_on:
      - karakeep_meilisearch
      - karakeep_chrome
    environment:
      NEXTAUTH_URL: \${NEXTAUTH_URL}
      NEXTAUTH_SECRET: \${NEXTAUTH_SECRET}
      MEILI_ADDR: http://karakeep_meilisearch:7700
      MEILI_MASTER_KEY: \${MEILI_MASTER_KEY}
      BROWSER_WEB_URL: http://karakeep_chrome:9222
      DATA_DIR: /data
    volumes:
      - karakeep-data:/data
  karakeep_meilisearch:
    image: getmeili/meilisearch:v1
    restart: always
    environment:
      MEILI_NO_ANALYTICS: "true"
      MEILI_MASTER_KEY: \${MEILI_MASTER_KEY}
    volumes:
      - karakeep-meili-data:/meili_data
  karakeep_chrome:
    image: gcr.io/zenika-hub/alpine-chrome:123
    restart: always
    command:
      - --no-sandbox
      - --disable-gpu
      - --disable-dev-shm-usage
      - --remote-debugging-address=0.0.0.0
      - --remote-debugging-port=9222
      - --hide-scrollbars
volumes:
  karakeep-data:
  karakeep-meili-data:
`,
	},
	{
		id: "paperless-ngx",
		name: "Paperless-ngx",
		description:
			"Document management system — scan, OCR, index and archive your paperwork with full-text search.",
		logo: "paperlessngx",
		tags: ["documents", "ocr", "dms"],
		links: {
			website: "https://docs.paperless-ngx.com",
			github: "https://github.com/paperless-ngx/paperless-ngx",
			docs: "https://docs.paperless-ngx.com",
		},
		suggestedDomain: { serviceName: "paperless", port: 8000 },
		env: [
			{
				key: "PAPERLESS_SECRET_KEY",
				default: "{{generateSecret}}",
				description: "Secret used to sign sessions and tokens",
			},
			{
				key: "PAPERLESS_URL",
				default: "http://localhost:8000",
				description: "Public URL of the instance (e.g. https://docs.example.com)",
			},
			{
				key: "PAPERLESS_ADMIN_USER",
				default: "admin",
				description: "Initial admin username",
			},
			{
				key: "PAPERLESS_ADMIN_PASSWORD",
				default: "{{generateSecret}}",
				description: "Initial admin password",
			},
		],
		compose: `services:
  paperless:
    image: ghcr.io/paperless-ngx/paperless-ngx:latest
    restart: always
    depends_on:
      - paperless_redis
    environment:
      PAPERLESS_REDIS: redis://paperless_redis:6379
      PAPERLESS_SECRET_KEY: \${PAPERLESS_SECRET_KEY}
      PAPERLESS_URL: \${PAPERLESS_URL}
      PAPERLESS_ADMIN_USER: \${PAPERLESS_ADMIN_USER}
      PAPERLESS_ADMIN_PASSWORD: \${PAPERLESS_ADMIN_PASSWORD}
      PAPERLESS_OCR_LANGUAGE: eng
    volumes:
      - paperless-data:/usr/src/paperless/data
      - paperless-media:/usr/src/paperless/media
      - paperless-export:/usr/src/paperless/export
      - paperless-consume:/usr/src/paperless/consume
  paperless_redis:
    image: redis:7-alpine
    restart: always
    volumes:
      - paperless-redis-data:/data
volumes:
  paperless-data:
  paperless-media:
  paperless-export:
  paperless-consume:
  paperless-redis-data:
`,
	},
	{
		id: "freshrss",
		name: "FreshRSS",
		description:
			"Self-hosted RSS and Atom feed aggregator — lightweight, fast and readable from any client via its API.",
		logo: "freshrss",
		tags: ["rss", "news", "reading"],
		links: {
			website: "https://freshrss.org",
			github: "https://github.com/FreshRSS/FreshRSS",
			docs: "https://freshrss.github.io/FreshRSS/en/",
		},
		suggestedDomain: { serviceName: "freshrss", port: 80 },
		env: [
			{
				key: "TZ",
				default: "UTC",
				description: "Timezone for feed refresh schedules (e.g. Europe/Paris)",
			},
		],
		compose: `services:
  freshrss:
    image: freshrss/freshrss:latest
    restart: always
    environment:
      TZ: \${TZ}
      CRON_MIN: "*/20"
    volumes:
      - freshrss-data:/var/www/FreshRSS/data
      - freshrss-extensions:/var/www/FreshRSS/extensions
volumes:
  freshrss-data:
  freshrss-extensions:
`,
	},
	{
		id: "miniflux",
		name: "Miniflux",
		description:
			"Minimalist, opinionated RSS reader — fast, no-nonsense feed reading with a Fever-compatible API.",
		logo: "rss",
		tags: ["rss", "news", "reading"],
		links: {
			website: "https://miniflux.app",
			github: "https://github.com/miniflux/v2",
			docs: "https://miniflux.app/docs/",
		},
		suggestedDomain: { serviceName: "miniflux", port: 8080 },
		env: [
			{
				key: "BASE_URL",
				default: "http://localhost:8080",
				description: "Public URL of the instance (e.g. https://feeds.example.com)",
			},
			{
				key: "ADMIN_USERNAME",
				default: "admin",
				description: "Initial admin username",
			},
			{
				key: "ADMIN_PASSWORD",
				default: "{{generateSecret}}",
				description: "Initial admin password",
			},
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the miniflux PostgreSQL user",
			},
		],
		compose: `services:
  miniflux:
    image: miniflux/miniflux:2.3.3
    restart: always
    depends_on:
      - miniflux_db
    environment:
      DATABASE_URL: postgres://miniflux:\${POSTGRES_PASSWORD}@miniflux_db:5432/miniflux?sslmode=disable
      RUN_MIGRATIONS: "1"
      CREATE_ADMIN: "1"
      ADMIN_USERNAME: \${ADMIN_USERNAME}
      ADMIN_PASSWORD: \${ADMIN_PASSWORD}
      BASE_URL: \${BASE_URL}
  miniflux_db:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: miniflux
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: miniflux
    volumes:
      - miniflux-db-data:/var/lib/postgresql/data
volumes:
  miniflux-db-data:
`,
	},
	{
		id: "bookstack",
		name: "BookStack",
		description:
			"Simple, self-hosted documentation platform — organize content into shelves, books, chapters and pages.",
		logo: "bookstack",
		tags: ["wiki", "docs", "knowledge"],
		links: {
			website: "https://www.bookstackapp.com",
			github: "https://github.com/BookStackApp/BookStack",
			docs: "https://www.bookstackapp.com/docs",
		},
		suggestedDomain: { serviceName: "bookstack", port: 6875 },
		env: [
			{
				key: "APP_URL",
				default: "http://localhost:6875",
				description: "Public URL of this BookStack instance",
			},
			{
				key: "DB_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the bundled MariaDB database",
			},
		],
		compose: `services:
  bookstack-db:
    image: lscr.io/linuxserver/mariadb:latest
    restart: always
    environment:
      PUID: "1000"
      PGID: "1000"
      TZ: UTC
      MYSQL_DATABASE: bookstack
      MYSQL_USER: bookstack
      MYSQL_PASSWORD: \${DB_PASSWORD}
      MYSQL_ROOT_PASSWORD: \${DB_PASSWORD}
    volumes:
      - bookstack-db-data:/config
  bookstack:
    image: lscr.io/linuxserver/bookstack:latest
    restart: always
    depends_on:
      - bookstack-db
    environment:
      PUID: "1000"
      PGID: "1000"
      TZ: UTC
      APP_URL: \${APP_URL}
      DB_HOST: bookstack-db
      DB_PORT: "3306"
      DB_USER: bookstack
      DB_PASS: \${DB_PASSWORD}
      DB_NAME: bookstack
    volumes:
      - bookstack-data:/config
volumes:
  bookstack-db-data:
  bookstack-data:
`,
	},
	{
		id: "wikijs",
		name: "Wiki.js",
		description:
			"Modern, powerful wiki engine — Markdown, visual editor, auth integrations and search built in.",
		logo: "wikidotjs",
		tags: ["wiki", "docs", "knowledge"],
		links: {
			website: "https://js.wiki",
			github: "https://github.com/requarks/wiki",
			docs: "https://docs.requarks.io",
		},
		suggestedDomain: { serviceName: "wikijs", port: 3000 },
		env: [
			{
				key: "DB_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the bundled PostgreSQL database",
			},
		],
		compose: `services:
  wikijs-db:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: wikijs
      POSTGRES_DB: wiki
      POSTGRES_PASSWORD: \${DB_PASSWORD}
    volumes:
      - wikijs-db-data:/var/lib/postgresql/data
  wikijs:
    image: ghcr.io/requarks/wiki:2
    restart: always
    depends_on:
      - wikijs-db
    environment:
      DB_TYPE: postgres
      DB_HOST: wikijs-db
      DB_USER: wikijs
      DB_NAME: wiki
      DB_PASS: \${DB_PASSWORD}
volumes:
  wikijs-db-data:
`,
	},
	{
		id: "dokuwiki",
		name: "DokuWiki",
		description:
			"Simple, versatile wiki that stores everything in plain text files — no database required.",
		logo: "",
		tags: ["wiki", "docs", "lightweight"],
		links: {
			website: "https://www.dokuwiki.org",
			github: "https://github.com/dokuwiki/dokuwiki",
			docs: "https://www.dokuwiki.org/manual",
		},
		suggestedDomain: { serviceName: "dokuwiki", port: 80 },
		env: [],
		compose: `services:
  dokuwiki:
    image: lscr.io/linuxserver/dokuwiki:latest
    restart: always
    environment:
      PUID: "1000"
      PGID: "1000"
      TZ: UTC
    volumes:
      - dokuwiki-data:/config
volumes:
  dokuwiki-data:
`,
	},
];
