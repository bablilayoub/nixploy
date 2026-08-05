import type { TemplateData } from "../types";

/** `${...}` sequences are escaped so the compose bodies keep them verbatim. */

export const communicationTemplates: TemplateData[] = [
	{
		id: "conduit",
		name: "Conduit",
		description:
			"Lightweight Matrix homeserver in Rust — federated chat that works with Element and other Matrix clients.",
		logo: "matrix",
		tags: ["chat", "matrix", "federated"],
		links: {
			website: "https://conduit.rs",
			github: "https://gitlab.com/famedly/conduit",
			docs: "https://docs.conduit.rs",
		},
		suggestedDomain: { serviceName: "conduit", port: 6167 },
		env: [
			{
				key: "CONDUIT_SERVER_NAME",
				default: "matrix.example.com",
				description: "Matrix server name (usually your domain)",
			},
		],
		compose: `services:
  conduit:
    image: matrixconduit/matrix-conduit:latest
    restart: always
    environment:
      CONDUIT_SERVER_NAME: \${CONDUIT_SERVER_NAME}
      CONDUIT_DATABASE_BACKEND: rocksdb
    volumes:
      - conduit-data:/var/lib/matrix-conduit
volumes:
  conduit-data:
`,
	},
	{
		id: "mumble-server",
		name: "Mumble Server",
		description:
			"Low-latency, high-quality voice chat server — the open-source TeamSpeak alternative.",
		logo: "mumble",
		tags: ["voice", "chat", "gaming"],
		links: {
			website: "https://www.mumble.info",
			github: "https://github.com/mumble-voip/mumble",
			docs: "https://www.mumble.info/documentation",
		},
		suggestedDomain: { serviceName: "mumble-server", port: 64738 },
		env: [
			{
				key: "MUMBLE_SUPERUSER_PASSWORD",
				default: "{{generateSecret}}",
				description: "SuperUser password for server administration",
			},
		],
		compose: `services:
  mumble-server:
    image: mumblevoip/mumble-server:latest
    restart: always
    environment:
      MUMBLE_SUPERUSER_PASSWORD: \${MUMBLE_SUPERUSER_PASSWORD}
    volumes:
      - mumble-data:/data
volumes:
  mumble-data:
`,
	},
];
