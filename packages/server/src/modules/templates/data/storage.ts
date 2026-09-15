import type { TemplateData } from "../types";

/** `${...}` sequences are escaped so the compose bodies keep them verbatim. */

export const storageTemplates: TemplateData[] = [
	{
		id: "filebrowser",
		name: "File Browser",
		description:
			"Web file manager for a directory on your server — upload, download, share and edit files.",
		logo: "files",
		tags: ["files", "storage", "sharing"],
		links: {
			website: "https://filebrowser.org",
			github: "https://github.com/filebrowser/filebrowser",
			docs: "https://filebrowser.org",
		},
		suggestedDomain: { serviceName: "filebrowser", port: 80 },
		env: [],
		compose: `services:
  filebrowser:
    image: filebrowser/filebrowser:latest
    restart: always
    volumes:
      - filebrowser-data:/srv
      - filebrowser-db:/database
volumes:
  filebrowser-data:
  filebrowser-db:
`,
	},
	{
		id: "syncthing",
		name: "Syncthing",
		description:
			"Continuous file synchronization between devices — peer-to-peer, encrypted, no central cloud.",
		logo: "syncthing",
		tags: ["files", "sync", "p2p"],
		links: {
			website: "https://syncthing.net",
			github: "https://github.com/syncthing/syncthing",
			docs: "https://docs.syncthing.net",
		},
		suggestedDomain: { serviceName: "syncthing", port: 8384 },
		env: [],
		compose: `services:
  syncthing:
    image: syncthing/syncthing:latest
    restart: always
    hostname: syncthing
    environment:
      PUID: "1000"
      PGID: "1000"
    volumes:
      - syncthing-data:/var/syncthing
volumes:
  syncthing-data:
`,
	},
	{
		id: "duplicati",
		name: "Duplicati",
		description:
			"Encrypted, incremental backups to S3, SFTP, WebDAV and more — with a web UI and scheduling.",
		logo: "duplicati",
		tags: ["backup", "storage", "encryption"],
		links: {
			website: "https://www.duplicati.com",
			github: "https://github.com/duplicati/duplicati",
			docs: "https://docs.duplicati.com",
		},
		suggestedDomain: { serviceName: "duplicati", port: 8200 },
		env: [],
		compose: `services:
  duplicati:
    image: lscr.io/linuxserver/duplicati:latest
    restart: always
    environment:
      PUID: "1000"
      PGID: "1000"
      TZ: UTC
    volumes:
      - duplicati-config:/config
      - duplicati-backups:/backups
volumes:
  duplicati-config:
  duplicati-backups:
`,
	},
	{
		id: "sftpgo",
		name: "SFTPGo",
		description:
			"SFTP, FTPS and WebDAV server with a web admin — virtual users, quotas and optional S3 or local backends.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/sftpgo.svg",
		tags: ["storage", "sftp", "webdav"],
		links: {
			website: "https://sftpgo.com",
			github: "https://github.com/drakkan/sftpgo",
			docs: "https://docs.sftpgo.com",
		},
		suggestedDomain: { serviceName: "sftpgo", port: 8080 },
		env: [],
		compose: `services:
  sftpgo:
    image: drakkan/sftpgo:latest
    restart: always
    environment:
      SFTPGO_HTTPD__BINDINGS__0__PORT: "8080"
      SFTPGO_HTTPD__BINDINGS__0__ADDRESS: ""
    volumes:
      - sftpgo-data:/srv/sftpgo
      - sftpgo-home:/var/lib/sftpgo
volumes:
  sftpgo-data:
  sftpgo-home:
`,
	},
	{
		id: "ocis",
		name: "ownCloud Infinite Scale",
		description:
			"ownCloud rewritten as a single Go binary — file sync and share, spaces and collaborative editing hooks.",
		logo: "owncloud",
		tags: ["storage", "files", "sync"],
		links: {
			website: "https://owncloud.com/infinite-scale/",
			github: "https://github.com/owncloud/ocis",
			docs: "https://doc.owncloud.com/ocis/next/",
		},
		suggestedDomain: { serviceName: "ocis", port: 9200 },
		env: [
			{
				key: "OCIS_URL",
				default: "https://ocis.example.com",
				description: "Public HTTPS URL of the instance — clients are redirected to it",
			},
			{
				key: "IDM_ADMIN_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the built-in admin account",
			},
		],
		compose: `services:
  ocis:
    image: owncloud/ocis:latest
    restart: always
    entrypoint: /bin/sh
    command: -c "ocis init || true; ocis server"
    environment:
      OCIS_URL: \${OCIS_URL}
      OCIS_LOG_LEVEL: warn
      OCIS_INSECURE: "true"
      PROXY_TLS: "false"
      IDM_ADMIN_PASSWORD: \${IDM_ADMIN_PASSWORD}
    volumes:
      - ocis-config:/etc/ocis
      - ocis-data:/var/lib/ocis
volumes:
  ocis-config:
  ocis-data:
`,
	},
	{
		id: "seafile",
		name: "Seafile",
		description:
			"File sync and share built on its own block storage — fast delta sync, libraries and client-side encryption.",
		logo: "seafile",
		tags: ["storage", "files", "sync"],
		links: {
			website: "https://www.seafile.com",
			github: "https://github.com/haiwen/seafile",
			docs: "https://manual.seafile.com",
		},
		suggestedDomain: { serviceName: "seafile", port: 80 },
		env: [
			{
				key: "SEAFILE_SERVER_HOSTNAME",
				default: "seafile.example.com",
				description: "Hostname the server is served on, without scheme",
			},
			{
				key: "SEAFILE_ADMIN_EMAIL",
				default: "admin@example.com",
				description: "Email of the account created on first boot",
			},
			{
				key: "SEAFILE_ADMIN_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of that account",
			},
			{
				key: "MYSQL_ROOT_PASSWORD",
				default: "{{generateSecret}}",
				description: "MariaDB root password — Seafile creates its own databases with it",
			},
		],
		compose: `services:
  seafile:
    image: seafileltd/seafile-mc:12.0-latest
    restart: always
    depends_on:
      - seafile_db
      - seafile_memcached
    environment:
      DB_HOST: seafile_db
      DB_ROOT_PASSWD: \${MYSQL_ROOT_PASSWORD}
      SEAFILE_MYSQL_DB_HOST: seafile_db
      SEAFILE_SERVER_HOSTNAME: \${SEAFILE_SERVER_HOSTNAME}
      SEAFILE_ADMIN_EMAIL: \${SEAFILE_ADMIN_EMAIL}
      SEAFILE_ADMIN_PASSWORD: \${SEAFILE_ADMIN_PASSWORD}
      SEAFILE_SERVER_LETSENCRYPT: "false"
      TIME_ZONE: Etc/UTC
    volumes:
      - seafile-data:/shared
  seafile_db:
    image: mariadb:11.8
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD: \${MYSQL_ROOT_PASSWORD}
      MYSQL_LOG_CONSOLE: "true"
    volumes:
      - seafile-db:/var/lib/mysql
  seafile_memcached:
    image: memcached:1.6-alpine
    restart: always
    entrypoint: memcached -m 256
volumes:
  seafile-data:
  seafile-db:
`,
	},
];
