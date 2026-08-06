/**
 * Landing marquee entries — names + simple-icons slugs from
 * `packages/server/src/modules/templates` (same CDN the dashboard uses).
 */
export const catalogTemplates = [
	{ name: "WordPress", logo: "wordpress" },
	{ name: "Ghost", logo: "ghost" },
	{ name: "Strapi", logo: "strapi" },
	{ name: "Directus", logo: "directus" },
	{ name: "n8n", logo: "n8n" },
	{ name: "MinIO", logo: "minio" },
	{ name: "Mattermost", logo: "mattermost" },
	{ name: "Cal.com", logo: "caldotcom" },
	{ name: "Chatwoot", logo: "chatwoot" },
	{ name: "Immich", logo: "immich" },
	{ name: "Supabase", logo: "supabase" },
	{ name: "Nextcloud", logo: "nextcloud" },
	{ name: "Gitea", logo: "gitea" },
	{ name: "Vaultwarden", logo: "vaultwarden" },
	{ name: "Portainer", logo: "portainer" },
	{ name: "Joplin", logo: "joplin" },
	{ name: "Plausible", logo: "plausibleanalytics" },
	{ name: "Umami", logo: "umami" },
	{ name: "Metabase", logo: "metabase" },
	{ name: "Matomo", logo: "matomo" },
	{ name: "Uptime Kuma", logo: "uptimekuma" },
	{ name: "Grafana", logo: "grafana" },
	{ name: "Prometheus", logo: "prometheus" },
	{ name: "Homarr", logo: "homarr" },
	{ name: "Jellyfin", logo: "jellyfin" },
	{ name: "Outline", logo: "outline" },
	{ name: "Paperless-ngx", logo: "paperlessngx" },
	{ name: "FreshRSS", logo: "freshrss" },
	{ name: "BookStack", logo: "bookstack" },
	{ name: "Wiki.js", logo: "wikidotjs" },
	{ name: "Listmonk", logo: "listmonk" },
	{ name: "ntfy", logo: "ntfy" },
	{ name: "Meilisearch", logo: "meilisearch" },
	{ name: "Excalidraw", logo: "excalidraw" },
	{ name: "Hoppscotch", logo: "hoppscotch" },
	{ name: "Ollama", logo: "ollama" },
	{ name: "Keycloak", logo: "keycloak" },
	{ name: "Authentik", logo: "authentik" },
	{ name: "Pi-hole", logo: "pihole" },
	{ name: "WireGuard", logo: "wireguard" },
	{ name: "Syncthing", logo: "syncthing" },
	{ name: "Actual Budget", logo: "actualbudget" },
	{ name: "Firefly III", logo: "fireflyiii" },
	{ name: "PostgreSQL", logo: "postgresql" },
	{ name: "MongoDB", logo: "mongodb" },
	{ name: "Redis", logo: "redis" },
] as const;

export type CatalogTemplate = (typeof catalogTemplates)[number];

/** Same CDN the dashboard templates UI uses. White ink for the monochrome landing. */
export function simpleIconUrl(logo: string, color = "white"): string {
	return `https://cdn.simpleicons.org/${logo}/${color}`;
}
