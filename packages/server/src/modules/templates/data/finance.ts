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
    image: postgres:16-alpine
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
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: ghostfolio
      POSTGRES_DB: ghostfolio
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
    volumes:
      - ghostfolio-db-data:/var/lib/postgresql/data
  redis:
    image: redis:7-alpine
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
];
