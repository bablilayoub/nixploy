import type { TemplateData } from "../types";

export const notificationTemplates: TemplateData[] = [
	{
		id: "ntfy",
		name: "ntfy",
		description:
			"Simple HTTP-based pub-sub push notifications — send alerts to your phone or desktop with a single POST.",
		logo: "ntfy",
		tags: ["notifications", "push", "automation"],
		links: {
			website: "https://ntfy.sh",
			github: "https://github.com/binwiederhier/ntfy",
			docs: "https://docs.ntfy.sh",
		},
		suggestedDomain: { serviceName: "ntfy", port: 80 },
		env: [
			{
				key: "BASE_URL",
				default: "http://localhost",
				description: "Public URL of the instance (e.g. https://ntfy.example.com)",
			},
		],
		compose: `services:
  ntfy:
    image: binwiederhier/ntfy:v2
    restart: always
    command: serve
    environment:
      NTFY_BASE_URL: \${BASE_URL}
      NTFY_CACHE_FILE: /var/cache/ntfy/cache.db
      NTFY_BEHIND_PROXY: "true"
    volumes:
      - ntfy-cache:/var/cache/ntfy
      - ntfy-config:/etc/ntfy
volumes:
  ntfy-cache:
  ntfy-config:
`,
	},
	{
		id: "gotify",
		name: "Gotify",
		description:
			"Self-hosted push notification server — send and receive real-time messages via a simple REST API and WebSockets.",
		logo: "pushbullet",
		tags: ["notifications", "push", "automation"],
		links: {
			website: "https://gotify.net",
			github: "https://github.com/gotify/server",
			docs: "https://gotify.net/docs/",
		},
		suggestedDomain: { serviceName: "gotify", port: 80 },
		env: [
			{
				key: "GOTIFY_DEFAULTUSER_NAME",
				default: "admin",
				description: "Initial admin username",
			},
			{
				key: "GOTIFY_DEFAULTUSER_PASS",
				default: "{{generateSecret}}",
				description: "Initial admin password",
			},
		],
		compose: `services:
  gotify:
    image: gotify/server:2
    restart: always
    environment:
      GOTIFY_DEFAULTUSER_NAME: \${GOTIFY_DEFAULTUSER_NAME}
      GOTIFY_DEFAULTUSER_PASS: \${GOTIFY_DEFAULTUSER_PASS}
      GOTIFY_SERVER_KEEPALIVEPERIOD: "0"
    volumes:
      - gotify-data:/app/data
volumes:
  gotify-data:
`,
	},
	{
		id: "listmonk",
		name: "Listmonk",
		description:
			"Self-hosted newsletter and mailing list manager — high-performance campaigns with a built-in analytics dashboard.",
		logo: "listmonk",
		tags: ["newsletter", "email", "marketing"],
		links: {
			website: "https://listmonk.app",
			github: "https://github.com/knadh/listmonk",
			docs: "https://listmonk.app/docs/",
		},
		suggestedDomain: { serviceName: "listmonk", port: 9000 },
		env: [
			{
				key: "TZ",
				default: "UTC",
				description: "Timezone for campaign schedules (e.g. Europe/Paris)",
			},
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the listmonk PostgreSQL user",
			},
		],
		compose: `services:
  listmonk:
    image: listmonk/listmonk:latest
    restart: always
    depends_on:
      - listmonk_db
    command:
      [
        sh,
        -c,
        "./listmonk --install --idempotent --yes --config='' && ./listmonk --config=''",
      ]
    environment:
      TZ: \${TZ}
      LISTMONK_app__address: 0.0.0.0:9000
      LISTMONK_db__host: listmonk_db
      LISTMONK_db__port: "5432"
      LISTMONK_db__user: listmonk
      LISTMONK_db__password: \${POSTGRES_PASSWORD}
      LISTMONK_db__database: listmonk
      LISTMONK_db__ssl_mode: disable
    volumes:
      - listmonk-uploads:/listmonk/uploads
  listmonk_db:
    image: postgres:17-alpine
    restart: always
    environment:
      POSTGRES_USER: listmonk
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: listmonk
    volumes:
      - listmonk-db-data:/var/lib/postgresql/data
volumes:
  listmonk-uploads:
  listmonk-db-data:
`,
	},
	{
		id: "apprise-api",
		name: "Apprise API",
		description:
			"One HTTP API to push notifications to 100+ services — Slack, Discord, Telegram, email and more.",
		logo: "https://raw.githubusercontent.com/caronc/apprise-api/master/apprise_api/static/favicon.ico",
		tags: ["notifications", "push", "api"],
		links: {
			github: "https://github.com/caronc/apprise-api",
			docs: "https://github.com/caronc/apprise",
		},
		suggestedDomain: { serviceName: "apprise-api", port: 8000 },
		env: [],
		compose: `services:
  apprise-api:
    image: caronc/apprise:latest
    restart: always
    volumes:
      - apprise-config:/config
volumes:
  apprise-config:
`,
	},
	{
		id: "mailpit",
		name: "Mailpit",
		description:
			"SMTP trap for development — every message your apps send lands in a web inbox instead of a real one, with an API to assert on.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/mailpit.svg",
		tags: ["email", "smtp", "testing"],
		links: {
			website: "https://mailpit.axllent.org",
			github: "https://github.com/axllent/mailpit",
			docs: "https://mailpit.axllent.org/docs/",
		},
		suggestedDomain: { serviceName: "mailpit", port: 8025 },
		env: [
			{
				key: "MP_UI_AUTH",
				default: "",
				description:
					'Optional "user:password" pair protecting the web UI — leave empty only on a private network',
			},
		],
		compose: `services:
  mailpit:
    image: axllent/mailpit:latest
    restart: always
    environment:
      MP_MAX_MESSAGES: "5000"
      MP_DATABASE: /data/mailpit.db
      MP_UI_AUTH: \${MP_UI_AUTH}
      MP_SMTP_AUTH_ACCEPT_ANY: "true"
      MP_SMTP_AUTH_ALLOW_INSECURE: "true"
    volumes:
      - mailpit-data:/data
volumes:
  mailpit-data:
`,
	},
];
