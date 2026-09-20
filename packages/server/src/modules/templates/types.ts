/**
 * One entry of the template catalog. Templates are stored as plain TS data
 * (no external fetch); each ships a `docker-compose.yml` body that may
 * reference env-schema keys with compose `${VAR}` interpolation. The deploy
 * flow materializes those values into the compose service's `.env` file.
 */
export interface TemplateEnvVar {
	key: string;
	/**
	 * Default value pre-filled in the deploy form. The special value
	 * `"{{generateSecret}}"` is replaced with a random secret at deploy time.
	 */
	default: string;
	description: string;
}

/**
 * A hostname the stack needs, read from one of its env values at deploy
 * time — a tunnel edge's endpoint host, the zone its tunnels are served
 * under. Attached as a domain of the compose service (HTTPS + Let's Encrypt
 * by default; a wildcard gets the DNS-01 resolver, or no certificate when
 * no DNS provider is linked) and, with automatic DNS records on, resolved
 * at the provider. Skipped while the value is still the template's
 * placeholder default. `modules/templates/domains.ts`.
 */
export interface TemplateDomainHint {
	/** Env key whose value is the hostname (the parent zone, for a wildcard). */
	env: string;
	serviceName: string;
	port: number;
	/** Attach `*.<value>` instead of `<value>`. */
	wildcard?: boolean;
	/** Serve over HTTPS with a Let's Encrypt certificate (default true). */
	https?: boolean;
}

export interface Template {
	/** Stable kebab-case identifier (e.g. "uptime-kuma"). */
	id: string;
	name: string;
	description: string;
	/** Brand mark: simple-icons slug (`cdn.simpleicons.org/<slug>`) or absolute image URL. */
	logo: string;
	/** Display category used for filtering (e.g. "Monitoring"). */
	category: string;
	tags: string[];
	links: {
		website?: string;
		docs?: string;
		github?: string;
	};
	/** `docker-compose.yml` body, stored verbatim (may use `${VAR}`). */
	compose: string;
	env: TemplateEnvVar[];
	/** Service + container port the optional domain should route to. */
	suggestedDomain: {
		serviceName: string;
		port: number;
	};
	/**
	 * What to do after deploying, in order, one short step each — the second
	 * domain to add, the client to point at it, the token to hand out. Shown
	 * in the panel's template details and on the template's landing page.
	 * Only for templates whose first use is not "open the URL".
	 */
	setup?: string[];
	/** Hostnames read from env values and attached on deploy ({@link TemplateDomainHint}). */
	domains?: TemplateDomainHint[];
	/**
	 * Needs host Docker socket and/or elevated capabilities. Deployable only by
	 * the instance admin; the resulting compose row is marked `hostPrivileged`.
	 */
	hostPrivileged?: boolean;
}

/** Catalog shape exposed by `template.all` (compose bodies stripped). */
export type TemplateSummary = Omit<Template, "compose">;

/**
 * Shape of the raw data files — everything but the category, which is
 * attached when the catalog is assembled (one category per data file).
 */
export type TemplateData = Omit<Template, "category">;
