import type { TemplateData } from "../types";

export const productivityTemplates: TemplateData[] = [
	{
		id: "nextcloud",
		name: "Nextcloud",
		description:
			"Self-hosted productivity platform — file sync & share, calendars, contacts, office and more.",
		logo: "nextcloud",
		tags: ["storage", "files", "productivity"],
		links: {
			website: "https://nextcloud.com",
			github: "https://github.com/nextcloud/server",
			docs: "https://docs.nextcloud.com",
		},
		suggestedDomain: { serviceName: "nextcloud", port: 80 },
		env: [
			{
				key: "NEXTCLOUD_ADMIN_USER",
				default: "admin",
				description: "Initial admin username",
			},
			{
				key: "NEXTCLOUD_ADMIN_PASSWORD",
				default: "{{generateSecret}}",
				description: "Initial admin password",
			},
			{
				key: "NEXTCLOUD_TRUSTED_DOMAINS",
				default: "localhost",
				description: "Space-separated list of trusted domains (add your domain here)",
			},
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the nextcloud PostgreSQL user",
			},
		],
		compose: `services:
  nextcloud:
    image: nextcloud:apache
    restart: always
    depends_on:
      - nextcloud_db
    environment:
      POSTGRES_HOST: nextcloud_db
      POSTGRES_DB: nextcloud
      POSTGRES_USER: nextcloud
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      NEXTCLOUD_ADMIN_USER: \${NEXTCLOUD_ADMIN_USER}
      NEXTCLOUD_ADMIN_PASSWORD: \${NEXTCLOUD_ADMIN_PASSWORD}
      NEXTCLOUD_TRUSTED_DOMAINS: \${NEXTCLOUD_TRUSTED_DOMAINS}
    volumes:
      - nextcloud-data:/var/www/html
  nextcloud_db:
    image: postgres:17-alpine
    restart: always
    environment:
      POSTGRES_USER: nextcloud
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: nextcloud
    volumes:
      - nextcloud-db-data:/var/lib/postgresql/data
volumes:
  nextcloud-data:
  nextcloud-db-data:
`,
	},
	{
		id: "gitea",
		name: "Gitea",
		description:
			"Lightweight self-hosted Git service — repositories, code review, issues, CI and package registry.",
		logo: "gitea",
		tags: ["git", "dev-tools"],
		links: {
			website: "https://about.gitea.com",
			github: "https://github.com/go-gitea/gitea",
			docs: "https://docs.gitea.com",
		},
		suggestedDomain: { serviceName: "gitea", port: 3000 },
		env: [
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the gitea PostgreSQL user",
			},
		],
		compose: `services:
  gitea:
    image: gitea/gitea:1
    restart: always
    depends_on:
      - gitea_db
    environment:
      USER_UID: "1000"
      USER_GID: "1000"
      GITEA__database__DB_TYPE: postgres
      GITEA__database__HOST: gitea_db:5432
      GITEA__database__NAME: gitea
      GITEA__database__USER: gitea
      GITEA__database__PASSWD: \${POSTGRES_PASSWORD}
    volumes:
      - gitea-data:/data
  gitea_db:
    image: postgres:17-alpine
    restart: always
    environment:
      POSTGRES_USER: gitea
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: gitea
    volumes:
      - gitea-db-data:/var/lib/postgresql/data
volumes:
  gitea-data:
  gitea-db-data:
`,
	},
	{
		id: "vaultwarden",
		name: "Vaultwarden",
		description:
			"Lightweight Bitwarden-compatible password manager server written in Rust — use with official Bitwarden clients.",
		logo: "vaultwarden",
		tags: ["security", "passwords"],
		links: {
			github: "https://github.com/dani-garcia/vaultwarden",
			docs: "https://github.com/dani-garcia/vaultwarden/wiki",
		},
		suggestedDomain: { serviceName: "vaultwarden", port: 80 },
		env: [
			{
				key: "DOMAIN",
				default: "http://localhost",
				description: "Public URL of the instance (e.g. https://vault.example.com)",
			},
			{
				key: "ADMIN_TOKEN",
				default: "{{generateSecret}}",
				description: "Token for the /admin panel (leave empty to disable)",
			},
		],
		compose: `services:
  vaultwarden:
    image: vaultwarden/server:latest
    restart: always
    environment:
      DOMAIN: \${DOMAIN}
      ADMIN_TOKEN: \${ADMIN_TOKEN}
      WEBSOCKET_ENABLED: "true"
    volumes:
      - vaultwarden-data:/data
volumes:
  vaultwarden-data:
`,
	},
	{
		id: "code-server",
		name: "code-server",
		description:
			"VS Code in the browser — run a full development environment on your server and code from anywhere.",
		logo: "coder",
		tags: ["dev-tools", "editor"],
		links: {
			github: "https://github.com/coder/code-server",
			docs: "https://coder.com/docs/code-server",
		},
		suggestedDomain: { serviceName: "code-server", port: 8080 },
		env: [
			{
				key: "PASSWORD",
				default: "{{generateSecret}}",
				description: "Password for the web UI",
			},
		],
		compose: `services:
  code-server:
    image: codercom/code-server:latest
    restart: always
    environment:
      PASSWORD: \${PASSWORD}
    volumes:
      - code-server-data:/home/coder
volumes:
  code-server-data:
`,
	},
	{
		id: "stirling-pdf",
		name: "Stirling PDF",
		description:
			"Self-hosted PDF toolbox — merge, split, convert, compress, OCR and sign PDFs from a web UI.",
		logo: "https://raw.githubusercontent.com/Stirling-Tools/Stirling-PDF/main/docs/stirling.png",
		tags: ["tools", "pdf"],
		links: {
			website: "https://www.stirlingpdf.com",
			github: "https://github.com/Stirling-Tools/Stirling-PDF",
			docs: "https://docs.stirlingpdf.com",
		},
		suggestedDomain: { serviceName: "stirling-pdf", port: 8080 },
		env: [],
		compose: `services:
  stirling-pdf:
    image: stirlingtools/stirling-pdf:latest
    restart: always
    volumes:
      - stirling-training-data:/usr/share/tessdata
      - stirling-configs:/configs
volumes:
  stirling-training-data:
  stirling-configs:
`,
	},
	{
		id: "portainer",
		name: "Portainer",
		description:
			"Container management UI — inspect and manage Docker/Swarm containers, images, networks and volumes. Requires instance admin (Docker socket).",
		logo: "portainer",
		tags: ["docker", "ops", "management", "privileged"],
		hostPrivileged: true,
		links: {
			website: "https://www.portainer.io",
			github: "https://github.com/portainer/portainer",
			docs: "https://docs.portainer.io",
		},
		suggestedDomain: { serviceName: "portainer", port: 9000 },
		env: [],
		compose: `services:
  portainer:
    image: portainer/portainer-ce:latest
    restart: always
    command: -H unix:///var/run/docker.sock
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - portainer-data:/data
volumes:
  portainer-data:
`,
	},
	{
		id: "joplin",
		name: "Joplin Server",
		description:
			"Sync backend for the Joplin note-taking app — end-to-end encrypted notes across all your devices.",
		logo: "joplin",
		tags: ["notes", "sync", "productivity"],
		links: {
			website: "https://joplinapp.org",
			github: "https://github.com/laurent22/joplin",
			docs: "https://joplinapp.org/help",
		},
		suggestedDomain: { serviceName: "joplin", port: 22300 },
		env: [
			{
				key: "APP_BASE_URL",
				default: "http://localhost:22300",
				description: "Public URL of the Joplin server",
			},
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the bundled PostgreSQL database",
			},
		],
		compose: `services:
  joplin-db:
    image: postgres:17-alpine
    restart: always
    environment:
      POSTGRES_USER: joplin
      POSTGRES_DB: joplin
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
    volumes:
      - joplin-db-data:/var/lib/postgresql/data
  joplin:
    image: joplin/server:latest
    restart: always
    depends_on:
      - joplin-db
    environment:
      APP_BASE_URL: \${APP_BASE_URL}
      DB_CLIENT: pg
      POSTGRES_HOST: joplin-db
      POSTGRES_USER: joplin
      POSTGRES_DATABASE: joplin
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      APP_PORT: "22300"
volumes:
  joplin-db-data:
`,
	},
	{
		id: "vikunja",
		name: "Vikunja",
		description:
			"The to-do app to organize your life — lists, Kanban, Gantt and table views with teams and sharing.",
		logo: "vikunja",
		tags: ["tasks", "kanban", "productivity"],
		links: {
			website: "https://vikunja.io",
			github: "https://kolaente.dev/vikunja/vikunja",
			docs: "https://vikunja.io/docs",
		},
		suggestedDomain: { serviceName: "vikunja", port: 3456 },
		env: [],
		compose: `services:
  vikunja:
    image: vikunja/vikunja:latest
    restart: always
    environment:
      VIKUNJA_SERVICE_PUBLICURL: http://localhost:3456
    volumes:
      - vikunja-data:/app/vikunja/files
volumes:
  vikunja-data:
`,
	},
	{
		id: "focalboard",
		name: "Focalboard",
		description:
			"Open-source project management — a self-hosted Trello/Notion-boards alternative by Mattermost.",
		logo: "mattermost",
		tags: ["tasks", "kanban", "project-management"],
		links: {
			website: "https://www.focalboard.com",
			github: "https://github.com/mattermost/focalboard",
		},
		suggestedDomain: { serviceName: "focalboard", port: 8000 },
		env: [],
		compose: `services:
  focalboard:
    image: mattermost/focalboard:latest
    restart: always
    volumes:
      - focalboard-data:/opt/focalboard/data
volumes:
  focalboard-data:
`,
	},
	{
		id: "kimai",
		name: "Kimai",
		description:
			"Professional time-tracking for freelancers and teams — projects, customers, invoices and reports.",
		logo: "https://raw.githubusercontent.com/kimai/www.kimai.org/master/images/kimai_logo.png",
		tags: ["time-tracking", "invoicing", "productivity"],
		links: {
			website: "https://www.kimai.org",
			github: "https://github.com/kimai/kimai",
			docs: "https://www.kimai.org/documentation",
		},
		suggestedDomain: { serviceName: "kimai", port: 8001 },
		env: [
			{
				key: "ADMINMAIL",
				default: "admin@example.com",
				description: "Initial admin account email",
			},
			{
				key: "ADMINPASS",
				default: "{{generateSecret}}",
				description: "Initial admin account password",
			},
		],
		compose: `services:
  kimai:
    image: kimai/kimai2:latest
    restart: always
    environment:
      ADMINMAIL: \${ADMINMAIL}
      ADMINPASS: \${ADMINPASS}
      DATABASE_URL: sqlite:///%kernel.project_dir%/var/data/kimai.sqlite
    volumes:
      - kimai-data:/opt/kimai/var
volumes:
  kimai-data:
`,
	},
	{
		id: "planka",
		name: "Planka",
		description:
			"Kanban boards in the Trello shape — lists, cards, labels, due dates and attachments, updated live across clients.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/planka.svg",
		tags: ["kanban", "project-management"],
		links: {
			website: "https://planka.app",
			github: "https://github.com/plankanban/planka",
			docs: "https://docs.planka.cloud",
		},
		suggestedDomain: { serviceName: "planka", port: 1337 },
		env: [
			{
				key: "BASE_URL",
				default: "http://localhost:1337",
				description: "Public URL of the instance (e.g. https://boards.example.com)",
			},
			{
				key: "SECRET_KEY",
				default: "{{generateSecret}}",
				description: "Signs session tokens",
			},
			{
				key: "DEFAULT_ADMIN_EMAIL",
				default: "admin@example.com",
				description: "Email of the account created on first boot",
			},
			{
				key: "DEFAULT_ADMIN_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of that account",
			},
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the planka PostgreSQL user",
			},
		],
		compose: `services:
  planka:
    image: ghcr.io/plankanban/planka:latest
    restart: always
    depends_on:
      - planka_db
    environment:
      BASE_URL: \${BASE_URL}
      SECRET_KEY: \${SECRET_KEY}
      DATABASE_URL: postgresql://planka:\${POSTGRES_PASSWORD}@planka_db/planka
      DEFAULT_ADMIN_EMAIL: \${DEFAULT_ADMIN_EMAIL}
      DEFAULT_ADMIN_PASSWORD: \${DEFAULT_ADMIN_PASSWORD}
      DEFAULT_ADMIN_NAME: Admin
      DEFAULT_ADMIN_USERNAME: admin
    volumes:
      - planka-favicons:/app/public/favicons
      - planka-user-avatars:/app/public/user-avatars
      - planka-attachments:/app/private/attachments
  planka_db:
    image: postgres:17-alpine
    restart: always
    environment:
      POSTGRES_USER: planka
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: planka
    volumes:
      - planka-db:/var/lib/postgresql/data
volumes:
  planka-favicons:
  planka-user-avatars:
  planka-attachments:
  planka-db:
`,
	},
	{
		id: "wekan",
		name: "Wekan",
		description:
			"Open-source kanban with swimlanes, per-board permissions and rules that move cards for you.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/wekan.svg",
		tags: ["kanban", "project-management"],
		links: {
			website: "https://wekan.github.io",
			github: "https://github.com/wekan/wekan",
			docs: "https://github.com/wekan/wekan/wiki",
		},
		suggestedDomain: { serviceName: "wekan", port: 8080 },
		env: [
			{
				key: "ROOT_URL",
				default: "http://localhost:8080",
				description: "Public URL of the instance — Wekan builds every link from it",
			},
		],
		compose: `services:
  wekan:
    image: wekanteam/wekan:latest
    restart: always
    depends_on:
      - wekan_db
    environment:
      ROOT_URL: \${ROOT_URL}
      PORT: "8080"
      MONGO_URL: mongodb://wekan_db:27017/wekan
      WITH_API: "true"
  wekan_db:
    image: mongo:8
    restart: always
    command: mongod --logpath /dev/null --oplogSize 128 --quiet
    volumes:
      - wekan-db:/data/db
volumes:
  wekan-db:
`,
	},
	{
		id: "kanboard",
		name: "Kanboard",
		description:
			"Minimalist project kanban — WIP limits, subtasks and time tracking in one small PHP app with no build step.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/kanboard.svg",
		tags: ["kanban", "project-management"],
		links: {
			website: "https://kanboard.org",
			github: "https://github.com/kanboard/kanboard",
			docs: "https://docs.kanboard.org",
		},
		suggestedDomain: { serviceName: "kanboard", port: 80 },
		env: [],
		compose: `services:
  kanboard:
    image: kanboard/kanboard:latest
    restart: always
    volumes:
      - kanboard-data:/var/www/app/data
      - kanboard-plugins:/var/www/app/plugins
volumes:
  kanboard-data:
  kanboard-plugins:
`,
	},
	{
		id: "homepage",
		name: "Homepage",
		description:
			"Configurable start page for a homelab — service tiles with live widgets, bookmarks and search, all from YAML.",
		logo: "homepage",
		tags: ["dashboard", "homelab"],
		links: {
			website: "https://gethomepage.dev",
			github: "https://github.com/gethomepage/homepage",
			docs: "https://gethomepage.dev/configs/",
		},
		suggestedDomain: { serviceName: "homepage", port: 3000 },
		env: [
			{
				key: "HOMEPAGE_ALLOWED_HOSTS",
				default: "localhost:3000",
				description:
					"Comma-separated host:port list the app will answer on — it refuses unknown Host headers",
			},
		],
		compose: `services:
  homepage:
    image: ghcr.io/gethomepage/homepage:latest
    restart: always
    environment:
      HOMEPAGE_ALLOWED_HOSTS: \${HOMEPAGE_ALLOWED_HOSTS}
    volumes:
      - homepage-config:/app/config
volumes:
  homepage-config:
`,
	},
	{
		id: "dashy",
		name: "Dashy",
		description:
			"Homelab dashboard with status checks, themes, keyboard shortcuts and an editor that writes its own config.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/png/dashy.png",
		tags: ["dashboard", "homelab"],
		links: {
			website: "https://dashy.to",
			github: "https://github.com/Lissy93/dashy",
			docs: "https://dashy.to/docs/",
		},
		suggestedDomain: { serviceName: "dashy", port: 8080 },
		env: [],
		compose: `services:
  dashy:
    image: lissy93/dashy:latest
    restart: always
    environment:
      NODE_ENV: production
    volumes:
      - dashy-config:/app/user-data
volumes:
  dashy-config:
`,
	},
	{
		id: "heimdall",
		name: "Heimdall",
		description:
			"Application dashboard that keeps it simple — a tile per service, optional API widgets, nothing else.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/heimdall.svg",
		tags: ["dashboard", "homelab"],
		links: {
			website: "https://heimdall.site",
			github: "https://github.com/linuxserver/Heimdall",
			docs: "https://docs.linuxserver.io/images/docker-heimdall/",
		},
		suggestedDomain: { serviceName: "heimdall", port: 80 },
		env: [],
		compose: `services:
  heimdall:
    image: lscr.io/linuxserver/heimdall:latest
    restart: always
    environment:
      PUID: "1000"
      PGID: "1000"
      TZ: Etc/UTC
    volumes:
      - heimdall-config:/config
volumes:
  heimdall-config:
`,
	},
	{
		id: "baikal",
		name: "Baïkal",
		description:
			"Lightweight CalDAV and CardDAV server — your calendars and contacts sync to iOS, Android and Thunderbird.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/baikal.svg",
		tags: ["calendar", "contacts", "caldav"],
		links: {
			website: "https://sabre.io/baikal/",
			github: "https://github.com/sabre-io/Baikal",
			docs: "https://sabre.io/baikal/install/",
		},
		suggestedDomain: { serviceName: "baikal", port: 80 },
		env: [],
		compose: `services:
  baikal:
    image: ckulka/baikal:nginx
    restart: always
    volumes:
      - baikal-config:/var/www/baikal/config
      - baikal-data:/var/www/baikal/Specific
volumes:
  baikal-config:
  baikal-data:
`,
	},
];
