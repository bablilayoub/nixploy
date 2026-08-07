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
    image: ghcr.io/mealie-recipes/mealie:v3.21.0
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
    image: postgres:16-alpine
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
];
