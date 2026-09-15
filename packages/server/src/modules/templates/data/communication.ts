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
	{
		id: "element-web",
		name: "Element",
		description:
			"Matrix web client — point it at your own homeserver (or matrix.org) for end-to-end encrypted chat and calls in the browser.",
		logo: "element",
		tags: ["chat", "matrix"],
		links: {
			website: "https://element.io",
			github: "https://github.com/element-hq/element-web",
			docs: "https://element.io/help",
		},
		suggestedDomain: { serviceName: "element", port: 80 },
		env: [],
		compose: `services:
  element:
    image: vectorim/element-web:latest
    restart: always
`,
	},
	{
		id: "ejabberd",
		name: "ejabberd",
		description:
			"Battle-tested XMPP server — messaging, MUC rooms and push, with a web admin on its own port.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/ejabberd.svg",
		tags: ["chat", "xmpp"],
		links: {
			website: "https://www.ejabberd.im",
			github: "https://github.com/processone/ejabberd",
			docs: "https://docs.ejabberd.im",
		},
		suggestedDomain: { serviceName: "ejabberd", port: 5280 },
		env: [
			{
				key: "XMPP_DOMAIN",
				default: "localhost",
				description: "XMPP domain served by this instance (e.g. chat.example.com)",
			},
			{
				key: "EJABBERD_ADMIN_USER",
				default: "admin",
				description: "Local part of the first admin account",
			},
			{
				key: "EJABBERD_ADMIN_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of that admin account",
			},
		],
		compose: `services:
  ejabberd:
    image: ejabberd/ecs:latest
    restart: always
    environment:
      XMPP_DOMAIN: \${XMPP_DOMAIN}
      EJABBERD_ADMIN: \${EJABBERD_ADMIN_USER}@\${XMPP_DOMAIN}
      CTL_ON_CREATE: register \${EJABBERD_ADMIN_USER} \${XMPP_DOMAIN} \${EJABBERD_ADMIN_PASSWORD}
    volumes:
      - ejabberd-database:/home/ejabberd/database
      - ejabberd-uploads:/home/ejabberd/upload
volumes:
  ejabberd-database:
  ejabberd-uploads:
`,
	},
];
