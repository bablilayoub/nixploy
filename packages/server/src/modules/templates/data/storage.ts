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
];
