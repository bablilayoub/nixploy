import type { TemplateData } from "../types";

export const analyticsTemplates: TemplateData[] = [
	{
		id: "plausible",
		name: "Plausible",
		description:
			"Lightweight, privacy-friendly web analytics — a cookieless Google Analytics alternative (PostgreSQL + ClickHouse).",
		logo: "plausibleanalytics",
		tags: ["analytics", "privacy"],
		links: {
			website: "https://plausible.io",
			github: "https://github.com/plausible/analytics",
			docs: "https://plausible.io/docs",
		},
		suggestedDomain: { serviceName: "plausible", port: 8000 },
		env: [
			{
				key: "BASE_URL",
				default: "http://localhost:8000",
				description: "Public URL of the instance (e.g. https://analytics.example.com)",
			},
			{
				key: "SECRET_KEY_BASE",
				default: "{{generateSecret}}",
				description: "Secret used to sign/encrypt cookies and tokens",
			},
		],
		compose: `services:
  plausible:
    image: plausible/analytics:v2
    restart: always
    command: sh -c "sleep 10 && /entrypoint.sh db createdb && /entrypoint.sh db migrate && /entrypoint.sh run"
    depends_on:
      - plausible_db
      - plausible_events_db
    environment:
      BASE_URL: \${BASE_URL}
      SECRET_KEY_BASE: \${SECRET_KEY_BASE}
      DATABASE_URL: postgres://postgres:postgres@plausible_db:5432/plausible
      CLICKHOUSE_DATABASE_URL: http://plausible_events_db:8123/plausible
  plausible_db:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_PASSWORD: postgres
    volumes:
      - plausible-db-data:/var/lib/postgresql/data
  plausible_events_db:
    image: clickhouse/clickhouse-server:24.3-alpine
    restart: always
    volumes:
      - plausible-events-data:/var/lib/clickhouse
volumes:
  plausible-db-data:
  plausible-events-data:
`,
	},
	{
		id: "umami",
		name: "Umami",
		description:
			"Simple, fast, privacy-focused website analytics — a self-hosted alternative to Google Analytics.",
		logo: "umami",
		tags: ["analytics", "privacy"],
		links: {
			website: "https://umami.is",
			github: "https://github.com/umami-software/umami",
			docs: "https://umami.is/docs",
		},
		suggestedDomain: { serviceName: "umami", port: 3000 },
		env: [
			{
				key: "APP_SECRET",
				default: "{{generateSecret}}",
				description: "Random string used to sign cookies and tokens",
			},
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the umami PostgreSQL user",
			},
		],
		compose: `services:
  umami:
    image: ghcr.io/umami-software/umami:postgresql-latest
    restart: always
    depends_on:
      - umami_db
    environment:
      DATABASE_URL: postgresql://umami:\${POSTGRES_PASSWORD}@umami_db:5432/umami
      DATABASE_TYPE: postgresql
      APP_SECRET: \${APP_SECRET}
  umami_db:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: umami
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: umami
    volumes:
      - umami-db-data:/var/lib/postgresql/data
volumes:
  umami-db-data:
`,
	},
	{
		id: "metabase",
		name: "Metabase",
		description:
			"Business intelligence for everyone — ask questions about your data and build dashboards without SQL.",
		logo: "metabase",
		tags: ["analytics", "bi", "dashboards"],
		links: {
			website: "https://www.metabase.com",
			github: "https://github.com/metabase/metabase",
			docs: "https://www.metabase.com/docs/latest",
		},
		suggestedDomain: { serviceName: "metabase", port: 3000 },
		env: [
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the metabase PostgreSQL user",
			},
		],
		compose: `services:
  metabase:
    image: metabase/metabase:latest
    restart: always
    depends_on:
      - metabase_db
    environment:
      MB_DB_TYPE: postgres
      MB_DB_HOST: metabase_db
      MB_DB_PORT: "5432"
      MB_DB_DBNAME: metabase
      MB_DB_USER: metabase
      MB_DB_PASS: \${POSTGRES_PASSWORD}
    volumes:
      - metabase-data:/metabase-data
  metabase_db:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: metabase
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: metabase
    volumes:
      - metabase-db-data:/var/lib/postgresql/data
volumes:
  metabase-data:
  metabase-db-data:
`,
	},
	{
		id: "matomo",
		name: "Matomo",
		description:
			"The leading open analytics platform — full-featured Google Analytics alternative with complete data ownership.",
		logo: "matomo",
		tags: ["analytics", "privacy", "dashboards"],
		links: {
			website: "https://matomo.org",
			github: "https://github.com/matomo-org/matomo",
			docs: "https://matomo.org/guides",
		},
		suggestedDomain: { serviceName: "matomo", port: 80 },
		env: [
			{
				key: "MATOMO_DATABASE_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the matomo database user",
			},
			{
				key: "MARIADB_ROOT_PASSWORD",
				default: "{{generateSecret}}",
				description: "MariaDB root password",
			},
		],
		compose: `services:
  matomo-db:
    image: mariadb:11
    restart: always
    environment:
      MARIADB_DATABASE: matomo
      MARIADB_USER: matomo
      MARIADB_PASSWORD: \${MATOMO_DATABASE_PASSWORD}
      MARIADB_ROOT_PASSWORD: \${MARIADB_ROOT_PASSWORD}
    volumes:
      - matomo-db-data:/var/lib/mysql
  matomo:
    image: matomo:latest
    restart: always
    depends_on:
      - matomo-db
    environment:
      MATOMO_DATABASE_HOST: matomo-db
      MATOMO_DATABASE_USERNAME: matomo
      MATOMO_DATABASE_DBNAME: matomo
      MATOMO_DATABASE_PASSWORD: \${MATOMO_DATABASE_PASSWORD}
    volumes:
      - matomo-data:/var/www/html
volumes:
  matomo-db-data:
  matomo-data:
`,
	},
];
