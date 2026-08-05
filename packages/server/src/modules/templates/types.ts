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

export interface Template {
	/** Stable kebab-case identifier (e.g. "uptime-kuma"). */
	id: string;
	name: string;
	description: string;
	/** simple-icons slug used with https://cdn.simpleicons.org/<slug>. */
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
}

/** Catalog shape exposed by `template.all` (compose bodies stripped). */
export type TemplateSummary = Omit<Template, "compose">;

/**
 * Shape of the raw data files — everything but the category, which is
 * attached when the catalog is assembled (one category per data file).
 */
export type TemplateData = Omit<Template, "category">;
