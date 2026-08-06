import type { TemplateData } from "../types";

export const appTemplates: TemplateData[] = [
	{
		id: "n8n",
		name: "n8n",
		description:
			"Workflow automation for technical people — connect 400+ apps with code-level flexibility, self-hosted.",
		logo: "n8n",
		tags: ["automation", "workflows"],
		links: {
			website: "https://n8n.io",
			github: "https://github.com/n8n-io/n8n",
			docs: "https://docs.n8n.io",
		},
		suggestedDomain: { serviceName: "n8n", port: 5678 },
		env: [
			{
				key: "N8N_HOST",
				default: "localhost",
				description: "Hostname the editor is served on (your domain)",
			},
			{
				key: "WEBHOOK_URL",
				default: "http://localhost:5678/",
				description: "Public URL used to build webhook endpoints (must end with /)",
			},
			{
				key: "GENERIC_TIMEZONE",
				default: "UTC",
				description: "Timezone for schedules (e.g. Europe/Berlin)",
			},
		],
		compose: `services:
  n8n:
    image: docker.n8n.io/n8nio/n8n:latest
    restart: always
    environment:
      N8N_HOST: \${N8N_HOST}
      N8N_PROTOCOL: https
      WEBHOOK_URL: \${WEBHOOK_URL}
      GENERIC_TIMEZONE: \${GENERIC_TIMEZONE}
    volumes:
      - n8n-data:/home/node/.n8n
volumes:
  n8n-data:
`,
	},
	{
		id: "minio",
		name: "MinIO",
		description:
			"High-performance, S3-compatible object storage — buckets, versioning and IAM policies on your own hardware.",
		logo: "minio",
		tags: ["storage", "s3"],
		links: {
			website: "https://min.io",
			github: "https://github.com/minio/minio",
			docs: "https://min.io/docs/minio/linux/index.html",
		},
		suggestedDomain: { serviceName: "minio", port: 9001 },
		env: [
			{
				key: "MINIO_ROOT_USER",
				default: "minioadmin",
				description: "Root (admin) username",
			},
			{
				key: "MINIO_ROOT_PASSWORD",
				default: "{{generateSecret}}",
				description: "Root (admin) password",
			},
		],
		compose: `services:
  minio:
    image: minio/minio:latest
    restart: always
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: \${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: \${MINIO_ROOT_PASSWORD}
    volumes:
      - minio-data:/data
volumes:
  minio-data:
`,
	},
	{
		id: "mattermost",
		name: "Mattermost",
		description:
			"Open-source team collaboration — self-hosted Slack alternative with channels, playbooks and integrations.",
		logo: "mattermost",
		tags: ["chat", "collaboration"],
		links: {
			website: "https://mattermost.com",
			github: "https://github.com/mattermost/mattermost",
			docs: "https://docs.mattermost.com",
		},
		suggestedDomain: { serviceName: "mattermost", port: 8065 },
		env: [
			{
				key: "SITE_URL",
				default: "http://localhost:8065",
				description: "Public URL of the instance (e.g. https://chat.example.com)",
			},
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the mattermost PostgreSQL user",
			},
		],
		compose: `services:
  mattermost:
    image: mattermost/mattermost-team-edition:latest
    restart: always
    depends_on:
      - mattermost_db
    environment:
      MM_SQLSETTINGS_DRIVERNAME: postgres
      MM_SQLSETTINGS_DATASOURCE: "postgres://mmuser:\${POSTGRES_PASSWORD}@mattermost_db:5432/mattermost?sslmode=disable&connect_timeout=10"
      MM_SERVICESETTINGS_SITEURL: \${SITE_URL}
    volumes:
      - mattermost-data:/mattermost/data
      - mattermost-config:/mattermost/config
      - mattermost-plugins:/mattermost/plugins
  mattermost_db:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: mmuser
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: mattermost
    volumes:
      - mattermost-db-data:/var/lib/postgresql/data
volumes:
  mattermost-data:
  mattermost-config:
  mattermost-plugins:
  mattermost-db-data:
`,
	},
	{
		id: "calcom",
		name: "Cal.com",
		description:
			"Open scheduling infrastructure — a self-hosted Calendly alternative for booking meetings.",
		logo: "caldotcom",
		tags: ["scheduling", "calendar"],
		links: {
			website: "https://cal.com",
			github: "https://github.com/calcom/cal.com",
			docs: "https://cal.com/docs",
		},
		suggestedDomain: { serviceName: "calcom", port: 3000 },
		env: [
			{
				key: "NEXT_PUBLIC_WEBAPP_URL",
				default: "http://localhost:3000",
				description: "Public URL of the app (e.g. https://cal.example.com)",
			},
			{
				key: "NEXTAUTH_SECRET",
				default: "{{generateSecret}}",
				description: "Secret for NextAuth session encryption",
			},
			{
				key: "CALENDSO_ENCRYPTION_KEY",
				default: "{{generateSecret}}",
				description: "Key used to encrypt stored credentials",
			},
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the calcom PostgreSQL user",
			},
		],
		compose: `services:
  calcom:
    image: calcom/cal.com:latest
    restart: always
    depends_on:
      - calcom_db
    environment:
      NEXT_PUBLIC_WEBAPP_URL: \${NEXT_PUBLIC_WEBAPP_URL}
      NEXT_PUBLIC_CONSOLE_URL: \${NEXT_PUBLIC_WEBAPP_URL}
      NEXT_PUBLIC_API_V2_URL: \${NEXT_PUBLIC_WEBAPP_URL}/api/v2
      NEXTAUTH_URL: \${NEXT_PUBLIC_WEBAPP_URL}
      NEXTAUTH_SECRET: \${NEXTAUTH_SECRET}
      CALENDSO_ENCRYPTION_KEY: \${CALENDSO_ENCRYPTION_KEY}
      DATABASE_URL: postgresql://postgres:\${POSTGRES_PASSWORD}@calcom_db:5432/calcom
      DATABASE_DIRECT_URL: postgresql://postgres:\${POSTGRES_PASSWORD}@calcom_db:5432/calcom
      EMAIL_FROM: notifications@example.com
  calcom_db:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: calcom
    volumes:
      - calcom-db-data:/var/lib/postgresql/data
volumes:
  calcom-db-data:
`,
	},
	{
		id: "chatwoot",
		name: "Chatwoot",
		description:
			"Open-source customer engagement suite — live chat, email and social inboxes in one dashboard.",
		logo: "chatwoot",
		tags: ["support", "chat", "crm"],
		links: {
			website: "https://www.chatwoot.com",
			github: "https://github.com/chatwoot/chatwoot",
			docs: "https://www.chatwoot.com/docs",
		},
		suggestedDomain: { serviceName: "chatwoot", port: 3000 },
		env: [
			{
				key: "FRONTEND_URL",
				default: "http://localhost:3000",
				description: "Public URL of the instance (e.g. https://support.example.com)",
			},
			{
				key: "SECRET_KEY_BASE",
				default: "{{generateSecret}}",
				description: "Rails secret key base",
			},
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description: "PostgreSQL password",
			},
		],
		compose: `services:
  chatwoot:
    image: chatwoot/chatwoot:latest
    restart: always
    command: bundle exec rails s -p 3000 -b 0.0.0.0
    depends_on:
      - chatwoot_db
      - chatwoot_redis
    environment: &chatwoot-env
      POSTGRES_HOST: chatwoot_db
      POSTGRES_USERNAME: postgres
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DATABASE: chatwoot
      REDIS_URL: redis://chatwoot_redis:6379
      SECRET_KEY_BASE: \${SECRET_KEY_BASE}
      FRONTEND_URL: \${FRONTEND_URL}
      RAILS_ENV: production
      NODE_ENV: production
    volumes:
      - chatwoot-data:/app/storage
  chatwoot_worker:
    image: chatwoot/chatwoot:latest
    restart: always
    command: bundle exec sidekiq -C config/sidekiq.yml
    depends_on:
      - chatwoot_db
      - chatwoot_redis
    environment: *chatwoot-env
    volumes:
      - chatwoot-data:/app/storage
  chatwoot_db:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: chatwoot
    volumes:
      - chatwoot-db-data:/var/lib/postgresql/data
  chatwoot_redis:
    image: redis:7-alpine
    restart: always
    volumes:
      - chatwoot-redis-data:/data
volumes:
  chatwoot-data:
  chatwoot-db-data:
  chatwoot-redis-data:
`,
	},
	{
		id: "immich",
		name: "Immich",
		description:
			"Self-hosted photo and video backup — a Google Photos alternative with mobile apps and ML search.",
		logo: "immich",
		tags: ["photos", "backup", "media"],
		links: {
			website: "https://immich.app",
			github: "https://github.com/immich-app/immich",
			docs: "https://immich.app/docs",
		},
		suggestedDomain: { serviceName: "immich-server", port: 2283 },
		env: [
			{
				key: "DB_PASSWORD",
				default: "{{generateSecret}}",
				description: "PostgreSQL password",
			},
		],
		compose: `services:
  immich-server:
    image: ghcr.io/immich-app/immich-server:release
    restart: always
    depends_on:
      - immich_redis
      - immich_db
    environment:
      DB_HOSTNAME: immich_db
      DB_USERNAME: postgres
      DB_PASSWORD: \${DB_PASSWORD}
      DB_DATABASE_NAME: immich
      REDIS_HOSTNAME: immich_redis
    volumes:
      - immich-upload:/usr/src/app/upload
  immich-machine-learning:
    image: ghcr.io/immich-app/immich-machine-learning:release
    restart: always
    volumes:
      - immich-model-cache:/cache
  immich_redis:
    image: redis:7-alpine
    restart: always
  immich_db:
    image: tensorchord/pgvecto-rs:pg14-v0.2.0
    restart: always
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: \${DB_PASSWORD}
      POSTGRES_DB: immich
    volumes:
      - immich-db-data:/var/lib/postgresql/data
volumes:
  immich-upload:
  immich-model-cache:
  immich-db-data:
`,
	},
	{
		id: "supabase",
		name: "Supabase",
		description:
			"Open-source Firebase alternative (starter stack) — Postgres, GoTrue auth, PostgREST and Studio. Expose `rest`/`auth` with extra domains for public API access.",
		logo: "supabase",
		tags: ["database", "backend", "auth", "api"],
		links: {
			website: "https://supabase.com",
			github: "https://github.com/supabase/supabase",
			docs: "https://supabase.com/docs/guides/self-hosting",
		},
		suggestedDomain: { serviceName: "studio", port: 3000 },
		env: [
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description:
					"Password for Postgres and built-in Supabase roles (letters+numbers; avoid special characters)",
			},
			{
				key: "JWT_SECRET",
				// Must match the default ANON_KEY / SERVICE_ROLE_KEY below (Supabase demo pair).
				default: "your-super-secret-jwt-token-with-at-least-32-characters-long",
				description:
					"HS256 secret used to sign JWTs — must match ANON_KEY and SERVICE_ROLE_KEY (rotate all three together)",
			},
			{
				key: "ANON_KEY",
				default:
					"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
				description: "Anon JWT (must be signed with JWT_SECRET)",
			},
			{
				key: "SERVICE_ROLE_KEY",
				default:
					"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
				description: "Service-role JWT (must be signed with JWT_SECRET)",
			},
			{
				key: "PG_META_CRYPTO_KEY",
				default: "{{generateSecret}}",
				description: "Encryption key for postgres-meta (at least 32 characters)",
			},
			{
				key: "SITE_URL",
				default: "http://localhost:3000",
				description: "Public URL of your frontend (used in auth emails/redirects)",
			},
			{
				key: "API_EXTERNAL_URL",
				default: "http://localhost:3000",
				description:
					"Public URL of the API (add a domain for the `rest` service and set its URL here)",
			},
		],
		// Image tags pinned to the official self-hosted compose. `db-roles` syncs
		// built-in role passwords (same job as docker/volumes/db/roles.sql).
		compose: `services:
  studio:
    image: supabase/studio:2026.08.03-sha-022b374
    restart: always
    depends_on:
      - rest
      - meta
    environment:
      HOSTNAME: "0.0.0.0"
      STUDIO_PG_META_URL: http://meta:8080
      POSTGRES_HOST: db
      POSTGRES_PORT: "5432"
      POSTGRES_DB: postgres
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_USER_READ_WRITE: postgres
      PG_META_CRYPTO_KEY: \${PG_META_CRYPTO_KEY}
      SUPABASE_PUBLIC_URL: \${API_EXTERNAL_URL}
      SUPABASE_URL: http://rest:3000
      SUPABASE_ANON_KEY: \${ANON_KEY}
      SUPABASE_SERVICE_KEY: \${SERVICE_ROLE_KEY}
      AUTH_JWT_SECRET: \${JWT_SECRET}
  db:
    image: supabase/postgres:15.8.1.085
    restart: always
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres", "-h", "localhost"]
      interval: 5s
      timeout: 5s
      retries: 10
    environment:
      POSTGRES_HOST: /var/run/postgresql
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      PGPASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: postgres
      JWT_SECRET: \${JWT_SECRET}
      JWT_EXP: "3600"
    command:
      [
        "postgres",
        "-c",
        "config_file=/etc/postgresql/postgresql.conf",
        "-c",
        "log_min_messages=fatal",
      ]
    volumes:
      - supabase-db-data:/var/lib/postgresql/data
  db-roles:
    image: supabase/postgres:15.8.1.085
    restart: "no"
    depends_on:
      db:
        condition: service_healthy
    environment:
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      PGPASSWORD: \${POSTGRES_PASSWORD}
    entrypoint: ["/bin/bash", "-c"]
    command:
      - |
        set -euo pipefail
        psql -h db -U postgres -d postgres -v ON_ERROR_STOP=1 \\
          -c "ALTER USER authenticator WITH PASSWORD '$$POSTGRES_PASSWORD'" \\
          -c "ALTER USER supabase_auth_admin WITH PASSWORD '$$POSTGRES_PASSWORD'" \\
          -c "ALTER USER supabase_admin WITH PASSWORD '$$POSTGRES_PASSWORD'" \\
          -c "ALTER USER supabase_storage_admin WITH PASSWORD '$$POSTGRES_PASSWORD'" \\
          -c "ALTER USER supabase_functions_admin WITH PASSWORD '$$POSTGRES_PASSWORD'"
  auth:
    image: supabase/gotrue:v2.189.0
    restart: always
    depends_on:
      db:
        condition: service_healthy
      db-roles:
        condition: service_completed_successfully
    environment:
      GOTRUE_API_HOST: 0.0.0.0
      GOTRUE_API_PORT: "9999"
      API_EXTERNAL_URL: \${API_EXTERNAL_URL}
      GOTRUE_DB_DRIVER: postgres
      GOTRUE_DB_DATABASE_URL: postgres://supabase_auth_admin:\${POSTGRES_PASSWORD}@db:5432/postgres
      GOTRUE_SITE_URL: \${SITE_URL}
      GOTRUE_JWT_SECRET: \${JWT_SECRET}
      GOTRUE_JWT_EXP: "3600"
      GOTRUE_JWT_ADMIN_ROLES: service_role
      GOTRUE_JWT_AUD: authenticated
      GOTRUE_JWT_DEFAULT_GROUP_NAME: authenticated
      GOTRUE_EXTERNAL_EMAIL_ENABLED: "true"
      GOTRUE_MAILER_AUTOCONFIRM: "true"
  rest:
    image: postgrest/postgrest:v14.12
    restart: always
    depends_on:
      db:
        condition: service_healthy
      db-roles:
        condition: service_completed_successfully
    environment:
      PGRST_DB_URI: postgres://authenticator:\${POSTGRES_PASSWORD}@db:5432/postgres
      PGRST_DB_SCHEMAS: public,graphql_public
      PGRST_DB_ANON_ROLE: anon
      PGRST_JWT_SECRET: \${JWT_SECRET}
      PGRST_APP_SETTINGS_JWT_SECRET: \${JWT_SECRET}
      PGRST_DB_USE_LEGACY_GUCS: "false"
  meta:
    image: supabase/postgres-meta:v0.96.6
    restart: always
    depends_on:
      db:
        condition: service_healthy
    environment:
      PG_META_PORT: "8080"
      PG_META_DB_HOST: db
      PG_META_DB_PORT: "5432"
      PG_META_DB_NAME: postgres
      PG_META_DB_USER: postgres
      PG_META_DB_PASSWORD: \${POSTGRES_PASSWORD}
      CRYPTO_KEY: \${PG_META_CRYPTO_KEY}
volumes:
  supabase-db-data:
`,
	},
];
