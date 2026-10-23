/** Per-kind service counts, as returned by `environment.byProject` (`services`). */
export interface ServiceCounts {
	applications: number;
	compose: number;
	postgres: number;
	mysql: number;
	mariadb: number;
	mongo: number;
	redis: number;
}

export const EMPTY_SERVICE_COUNTS: ServiceCounts = {
	applications: 0,
	compose: 0,
	postgres: 0,
	mysql: 0,
	mariadb: 0,
	mongo: 0,
	redis: 0,
};

/** Add up counts (or `project.one`-style arrays) from several environments. */
export function sumServiceCounts(
	environments: Array<{ services: { [K in keyof ServiceCounts]: number | unknown[] } }>,
): ServiceCounts {
	const total = { ...EMPTY_SERVICE_COUNTS };
	for (const environment of environments) {
		for (const kind of Object.keys(total) as (keyof ServiceCounts)[]) {
			const value = environment.services[kind];
			total[kind] += Array.isArray(value) ? value.length : (value ?? 0);
		}
	}
	return total;
}

function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * "2 applications, 1 compose stack and 3 databases" — what a cascade delete
 * removes. `null` when nothing exists yet.
 */
export function describeServiceCounts(counts: ServiceCounts): string | null {
	const databases = counts.postgres + counts.mysql + counts.mariadb + counts.mongo + counts.redis;
	const parts: string[] = [];
	if (counts.applications > 0) parts.push(plural(counts.applications, "application"));
	if (counts.compose > 0) parts.push(plural(counts.compose, "compose stack"));
	if (databases > 0) parts.push(plural(databases, "database"));
	const last = parts.pop();
	if (!last) return null;
	if (parts.length === 0) return last;
	return `${parts.join(", ")} and ${last}`;
}
