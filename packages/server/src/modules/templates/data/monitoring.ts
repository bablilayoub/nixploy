import type { TemplateData } from "../types";

/** `${...}` sequences are escaped so the compose bodies keep them verbatim. */

export const monitoringTemplates: TemplateData[] = [
	{
		id: "uptime-kuma",
		name: "Uptime Kuma",
		description:
			"Self-hosted monitoring tool like Uptime Robot — HTTP(s), TCP, ping, DNS and keyword monitors with status pages.",
		logo: "uptimekuma",
		tags: ["monitoring", "status-page"],
		links: {
			website: "https://uptime.kuma.pet",
			github: "https://github.com/louislam/uptime-kuma",
			docs: "https://github.com/louislam/uptime-kuma/wiki",
		},
		suggestedDomain: { serviceName: "uptime-kuma", port: 3001 },
		env: [],
		compose: `services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    restart: always
    volumes:
      - uptime-kuma-data:/app/data
volumes:
  uptime-kuma-data:
`,
	},
	{
		id: "grafana",
		name: "Grafana",
		description:
			"Open observability platform — query, visualize and alert on metrics, logs and traces from any data source.",
		logo: "grafana",
		tags: ["monitoring", "metrics", "dashboards"],
		links: {
			website: "https://grafana.com",
			github: "https://github.com/grafana/grafana",
			docs: "https://grafana.com/docs/grafana/latest",
		},
		suggestedDomain: { serviceName: "grafana", port: 3000 },
		env: [
			{
				key: "GF_SECURITY_ADMIN_USER",
				default: "admin",
				description: "Initial admin username",
			},
			{
				key: "GF_SECURITY_ADMIN_PASSWORD",
				default: "{{generateSecret}}",
				description: "Initial admin password",
			},
			{
				key: "GF_SERVER_ROOT_URL",
				default: "http://localhost:3000",
				description: "Public URL of this Grafana instance",
			},
		],
		compose: `services:
  grafana:
    image: grafana/grafana:latest
    restart: always
    environment:
      GF_SECURITY_ADMIN_USER: \${GF_SECURITY_ADMIN_USER}
      GF_SECURITY_ADMIN_PASSWORD: \${GF_SECURITY_ADMIN_PASSWORD}
      GF_SERVER_ROOT_URL: \${GF_SERVER_ROOT_URL}
    volumes:
      - grafana-data:/var/lib/grafana
volumes:
  grafana-data:
`,
	},
	{
		id: "prometheus",
		name: "Prometheus",
		description:
			"Systems and service monitoring — a time-series database with a powerful query language (PromQL) and alerting.",
		logo: "prometheus",
		tags: ["monitoring", "metrics"],
		links: {
			website: "https://prometheus.io",
			github: "https://github.com/prometheus/prometheus",
			docs: "https://prometheus.io/docs",
		},
		suggestedDomain: { serviceName: "prometheus", port: 9090 },
		env: [],
		compose: `services:
  prometheus:
    image: prom/prometheus:latest
    restart: always
    command:
      - "--config.file=/etc/prometheus/prometheus.yml"
      - "--storage.tsdb.path=/prometheus"
      - "--storage.tsdb.retention.time=15d"
    volumes:
      - prometheus-data:/prometheus
volumes:
  prometheus-data:
`,
	},
	{
		id: "loki",
		name: "Loki",
		description:
			"Grafana's horizontally-scalable log aggregation system, inspired by Prometheus — pairs with Grafana for log exploration.",
		logo: "grafana",
		tags: ["monitoring", "logs"],
		links: {
			website: "https://grafana.com/oss/loki",
			github: "https://github.com/grafana/loki",
			docs: "https://grafana.com/docs/loki/latest",
		},
		suggestedDomain: { serviceName: "loki", port: 3100 },
		env: [],
		compose: `services:
  loki:
    image: grafana/loki:3
    restart: always
    command: -config.file=/etc/loki/local-config.yaml
    volumes:
      - loki-data:/loki
volumes:
  loki-data:
`,
	},
	{
		id: "changedetection",
		name: "changedetection.io",
		description:
			"Website change detection and notification — monitor pages for updates, restocks and price drops.",
		logo: "changedetection",
		tags: ["monitoring", "automation"],
		links: {
			website: "https://changedetection.io",
			github: "https://github.com/dgtlmoon/changedetection.io",
			docs: "https://github.com/dgtlmoon/changedetection.io/wiki",
		},
		suggestedDomain: { serviceName: "changedetection", port: 5000 },
		env: [],
		compose: `services:
  changedetection:
    image: ghcr.io/dgtlmoon/changedetection.io:latest
    restart: always
    volumes:
      - changedetection-data:/datastore
volumes:
  changedetection-data:
`,
	},
	{
		id: "dozzle",
		name: "Dozzle",
		description:
			"Lightweight real-time log viewer for Docker containers — simple web UI with search and live streaming. Requires instance admin (Docker socket).",
		logo: "docker",
		tags: ["monitoring", "logs", "docker", "privileged"],
		hostPrivileged: true,
		links: {
			website: "https://dozzle.dev",
			github: "https://github.com/amir20/dozzle",
			docs: "https://dozzle.dev/guide/getting-started",
		},
		suggestedDomain: { serviceName: "dozzle", port: 8080 },
		env: [],
		compose: `services:
  dozzle:
    image: amir20/dozzle:v8
    restart: always
    environment:
      DOZZLE_MODE: swarm
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
`,
	},
	{
		id: "homarr",
		name: "Homarr",
		description:
			"Sleek, modern dashboard for your self-hosted services — arrange apps and integrations on drag-and-drop boards.",
		logo: "homarr",
		tags: ["dashboard", "monitoring", "home"],
		links: {
			website: "https://homarr.dev",
			github: "https://github.com/homarr-labs/homarr",
			docs: "https://homarr.dev/docs/",
		},
		suggestedDomain: { serviceName: "homarr", port: 7575 },
		env: [],
		compose: `services:
  homarr:
    image: ghcr.io/homarr-labs/homarr:v1.77.1
    restart: always
    volumes:
      - homarr-data:/appdata
volumes:
  homarr-data:
`,
	},
	{
		id: "healthchecks",
		name: "Healthchecks",
		description:
			"Dead-man's-switch monitoring for cron jobs and backups — each job pings a URL, silence raises the alert.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/healthchecks.svg",
		tags: ["monitoring", "cron", "alerting"],
		links: {
			website: "https://healthchecks.io",
			github: "https://github.com/healthchecks/healthchecks",
			docs: "https://healthchecks.io/docs/self_hosted/",
		},
		suggestedDomain: { serviceName: "healthchecks", port: 8000 },
		env: [
			{
				key: "SITE_ROOT",
				default: "http://localhost:8000",
				description: "Public URL of the instance — it is baked into the ping URLs it hands out",
			},
			{
				key: "SECRET_KEY",
				default: "{{generateSecret}}",
				description: "Django secret key — changing it signs everyone out",
			},
			{
				key: "SUPERUSER_EMAIL",
				default: "admin@example.com",
				description: "Email of the account created on first boot",
			},
			{
				key: "SUPERUSER_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of that account",
			},
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the healthchecks PostgreSQL user",
			},
		],
		compose: `services:
  healthchecks:
    image: healthchecks/healthchecks:latest
    restart: always
    depends_on:
      - healthchecks_db
    environment:
      SITE_ROOT: \${SITE_ROOT}
      SITE_NAME: Healthchecks
      SECRET_KEY: \${SECRET_KEY}
      SUPERUSER_EMAIL: \${SUPERUSER_EMAIL}
      SUPERUSER_PASSWORD: \${SUPERUSER_PASSWORD}
      ALLOWED_HOSTS: "*"
      DB: postgres
      DB_HOST: healthchecks_db
      DB_NAME: healthchecks
      DB_USER: healthchecks
      DB_PASSWORD: \${POSTGRES_PASSWORD}
    volumes:
      - healthchecks-data:/data
  healthchecks_db:
    image: postgres:17-alpine
    restart: always
    environment:
      POSTGRES_USER: healthchecks
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: healthchecks
    volumes:
      - healthchecks-db:/var/lib/postgresql/data
volumes:
  healthchecks-data:
  healthchecks-db:
`,
	},
	{
		id: "beszel",
		name: "Beszel",
		description:
			"Tiny server monitor — CPU, memory, disk, network and container stats from agents on each machine, with alerts.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/beszel.svg",
		tags: ["monitoring", "metrics"],
		links: {
			website: "https://beszel.dev",
			github: "https://github.com/henrygd/beszel",
			docs: "https://beszel.dev/guide/getting-started",
		},
		suggestedDomain: { serviceName: "beszel", port: 8090 },
		env: [],
		compose: `services:
  beszel:
    image: henrygd/beszel:latest
    restart: always
    volumes:
      - beszel-data:/beszel_data
volumes:
  beszel-data:
`,
	},
	{
		id: "speedtest-tracker",
		name: "Speedtest Tracker",
		description:
			"Runs Ookla speed tests on a schedule and charts the result — evidence for the conversation with your ISP.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/speedtest-tracker.svg",
		tags: ["monitoring", "network"],
		links: {
			website: "https://docs.speedtest-tracker.dev",
			github: "https://github.com/alexjustesen/speedtest-tracker",
			docs: "https://docs.speedtest-tracker.dev/getting-started/installation",
		},
		suggestedDomain: { serviceName: "speedtest-tracker", port: 80 },
		env: [
			{
				key: "APP_KEY",
				default: "",
				description:
					"Laravel key in the form `base64:...` (`echo -n 'base64:'; openssl rand -base64 32`)",
			},
			{
				key: "APP_URL",
				default: "http://localhost",
				description: "Public URL of the instance",
			},
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the speedtest PostgreSQL user",
			},
		],
		compose: `services:
  speedtest-tracker:
    image: lscr.io/linuxserver/speedtest-tracker:latest
    restart: always
    depends_on:
      - speedtest_db
    environment:
      PUID: "1000"
      PGID: "1000"
      APP_KEY: \${APP_KEY}
      APP_URL: \${APP_URL}
      DB_CONNECTION: pgsql
      DB_HOST: speedtest_db
      DB_PORT: "5432"
      DB_DATABASE: speedtest
      DB_USERNAME: speedtest
      DB_PASSWORD: \${POSTGRES_PASSWORD}
    volumes:
      - speedtest-config:/config
  speedtest_db:
    image: postgres:17-alpine
    restart: always
    environment:
      POSTGRES_USER: speedtest
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: speedtest
    volumes:
      - speedtest-db:/var/lib/postgresql/data
volumes:
  speedtest-config:
  speedtest-db:
`,
	},
];
