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
    image: ghcr.io/homarr-labs/homarr:v1.72.0
    restart: always
    volumes:
      - homarr-data:/appdata
volumes:
  homarr-data:
`,
	},
];
