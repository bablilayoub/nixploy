import type { TemplateData } from "../types";

export const financeTemplates: TemplateData[] = [
	{
		id: "actual-budget",
		name: "Actual Budget",
		description:
			"Local-first personal finance app — fast envelope budgeting with multi-device sync and bank import.",
		logo: "actualbudget",
		tags: ["finance", "budgeting"],
		links: {
			website: "https://actualbudget.org",
			github: "https://github.com/actualbudget/actual",
			docs: "https://actualbudget.org/docs/",
		},
		suggestedDomain: { serviceName: "actual-budget", port: 5006 },
		env: [],
		compose: `services:
  actual-budget:
    image: actualbudget/actual-server:latest
    restart: always
    volumes:
      - actual-data:/data
volumes:
  actual-data:
`,
	},
	{
		id: "firefly-iii",
		name: "Firefly III",
		description:
			"Self-hosted personal finance manager — track expenses, budgets, bills and assets with detailed reports.",
		logo: "fireflyiii",
		tags: ["finance", "budgeting"],
		links: {
			website: "https://www.firefly-iii.org",
			github: "https://github.com/firefly-iii/firefly-iii",
			docs: "https://docs.firefly-iii.org",
		},
		suggestedDomain: { serviceName: "firefly", port: 8080 },
		env: [
			{
				key: "APP_KEY",
				default: "",
				description:
					"Exactly 32 random characters used for encryption (e.g. output of `openssl rand -hex 16`)",
			},
			{
				key: "APP_URL",
				default: "http://localhost:8080",
				description: "Public URL of the instance (e.g. https://money.example.com)",
			},
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the firefly PostgreSQL user",
			},
		],
		compose: `services:
  firefly:
    image: fireflyiii/core:latest
    restart: always
    depends_on:
      - firefly_db
    environment:
      APP_ENV: production
      APP_KEY: \${APP_KEY}
      APP_URL: \${APP_URL}
      APP_DEBUG: "false"
      DB_CONNECTION: pgsql
      DB_HOST: firefly_db
      DB_PORT: "5432"
      DB_DATABASE: firefly
      DB_USERNAME: firefly
      DB_PASSWORD: \${POSTGRES_PASSWORD}
      TRUSTED_PROXIES: "**"
    volumes:
      - firefly-upload:/var/www/html/storage/upload
  firefly_db:
    image: postgres:17-alpine
    restart: always
    environment:
      POSTGRES_USER: firefly
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: firefly
    volumes:
      - firefly-db-data:/var/lib/postgresql/data
volumes:
  firefly-upload:
  firefly-db-data:
`,
	},
	{
		id: "ghostfolio",
		name: "Ghostfolio",
		description:
			"Privacy-first wealth management — track stocks, ETFs and crypto across all your accounts in one dashboard.",
		logo: "ghostfolio",
		tags: ["finance", "investing", "portfolio"],
		links: {
			website: "https://ghostfol.io",
			github: "https://github.com/ghostfolio/ghostfolio",
			docs: "https://github.com/ghostfolio/ghostfolio",
		},
		suggestedDomain: { serviceName: "ghostfolio", port: 3333 },
		env: [
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the bundled PostgreSQL database",
			},
			{
				key: "ACCESS_TOKEN_SALT",
				default: "{{generateSecret}}",
				description: "Salt used for access token hashing",
			},
		],
		compose: `services:
  postgres:
    image: postgres:17-alpine
    restart: always
    environment:
      POSTGRES_USER: ghostfolio
      POSTGRES_DB: ghostfolio
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
    volumes:
      - ghostfolio-db-data:/var/lib/postgresql/data
  redis:
    image: redis:8-alpine
    restart: always
  ghostfolio:
    image: ghostfolio/ghostfolio:latest
    restart: always
    depends_on:
      - postgres
      - redis
    environment:
      DATABASE_URL: postgresql://ghostfolio:\${POSTGRES_PASSWORD}@postgres:5432/ghostfolio
      REDIS_HOST: redis
      REDIS_PORT: "6379"
      ACCESS_TOKEN_SALT: \${ACCESS_TOKEN_SALT}
volumes:
  ghostfolio-db-data:
`,
	},
	{
		id: "wallos",
		name: "Wallos",
		description:
			"Subscription tracker — every recurring charge in one place, with renewal reminders and spend by category.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/wallos.svg",
		tags: ["finance", "subscriptions"],
		links: {
			website: "https://wallosapp.com",
			github: "https://github.com/ellite/Wallos",
			docs: "https://github.com/ellite/Wallos#readme",
		},
		suggestedDomain: { serviceName: "wallos", port: 80 },
		env: [],
		compose: `services:
  wallos:
    image: bellamy/wallos:latest
    restart: always
    environment:
      TZ: Etc/UTC
    volumes:
      - wallos-db:/var/www/html/db
      - wallos-logos:/var/www/html/images/uploads/logos
volumes:
  wallos-db:
  wallos-logos:
`,
	},
	{
		id: "maybe-finance",
		name: "Maybe",
		description:
			"Personal finance and wealth dashboard — accounts, net worth over time, budgets and holdings in one ledger.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/maybe.svg",
		tags: ["finance", "budgeting", "investing"],
		links: {
			website: "https://maybefinance.com",
			github: "https://github.com/maybe-finance/maybe",
			docs: "https://github.com/maybe-finance/maybe#readme",
		},
		suggestedDomain: { serviceName: "maybe", port: 3000 },
		env: [
			{
				key: "SECRET_KEY_BASE",
				default: "{{generateSecret}}",
				description: "Rails session secret — changing it signs everyone out",
			},
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the maybe PostgreSQL user",
			},
		],
		compose: `services:
  maybe:
    image: ghcr.io/maybe-finance/maybe:latest
    restart: always
    depends_on:
      - maybe_db
    environment:
      SELF_HOSTED: "true"
      RAILS_FORCE_SSL: "false"
      RAILS_ASSUME_SSL: "false"
      SECRET_KEY_BASE: \${SECRET_KEY_BASE}
      DB_HOST: maybe_db
      POSTGRES_DB: maybe
      POSTGRES_USER: maybe
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
    volumes:
      - maybe-storage:/rails/storage
  maybe_db:
    image: postgres:17-alpine
    restart: always
    environment:
      POSTGRES_USER: maybe
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: maybe
    volumes:
      - maybe-db:/var/lib/postgresql/data
volumes:
  maybe-storage:
  maybe-db:
`,
	},
];
