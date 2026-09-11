/**
 * Curated engine versions for the five one-click databases.
 *
 * The free-text `dockerImage` column stays the escape hatch (Timescale,
 * pgvector, Bitnami images, a pinned digest…). What this file adds is the
 * boring path: a short list of tags the project actually tests, an EOL hint
 * where one applies, and a deterministic `engineVersion → image` mapping so
 * the panel can offer a dropdown instead of asking operators to type an OCI
 * reference.
 *
 * Deliberately free of imports: the panel bundles it through
 * `@nixploy/server/modules/databases/versions` to render the picker.
 */

export type DatabaseVersionKind = "postgres" | "mysql" | "mariadb" | "mongo" | "redis";

export interface DatabaseVersion {
	/** Stored in `<engine>.engine_version` and used as the image tag. */
	version: string;
	/** Rendered next to the option, e.g. an end-of-life warning. */
	note?: string;
	/** Offered as the default for a new service. */
	recommended?: boolean;
}

/**
 * Major-version ladders as of 2026-09. `note` carries the operational
 * warning, not marketing copy: an operator picking an EOL engine should see
 * it in the dropdown, not in a changelog.
 */
export const DATABASE_VERSIONS: Record<DatabaseVersionKind, readonly DatabaseVersion[]> = {
	postgres: [
		{ version: "18", recommended: true },
		{ version: "17" },
		{ version: "16" },
		{ version: "15", note: "Oldest supported major; upstream EOL is near" },
	],
	mysql: [
		{ version: "9", recommended: true },
		{ version: "8.4", note: "LTS" },
		{ version: "8.0", note: "Extended support only" },
	],
	mariadb: [
		{ version: "11.8", recommended: true },
		{ version: "11.4", note: "LTS" },
		{ version: "10.11", note: "LTS, older series" },
	],
	mongo: [
		{ version: "8", recommended: true },
		{ version: "7" },
		{ version: "6", note: "End of life" },
	],
	redis: [
		{ version: "8", recommended: true },
		{ version: "7.4" },
		{ version: "7.2", note: "Older stable series" },
	],
};

/** Image repository each engine's curated versions are tagged on. */
const IMAGE_REPOSITORY: Record<DatabaseVersionKind, string> = {
	postgres: "postgres",
	mysql: "mysql",
	mariadb: "mariadb",
	mongo: "mongo",
	redis: "redis",
};

/** `("postgres", "17") → "postgres:17"`. */
export const imageForVersion = (kind: DatabaseVersionKind, version: string): string =>
	`${IMAGE_REPOSITORY[kind]}:${version}`;

/** Whether `version` is one of the curated tags for this engine. */
export const isCuratedVersion = (kind: DatabaseVersionKind, version: string): boolean =>
	DATABASE_VERSIONS[kind].some((entry) => entry.version === version);

/** The version a new service gets when the caller does not pick one. */
export const recommendedVersion = (kind: DatabaseVersionKind): string => {
	const entry =
		DATABASE_VERSIONS[kind].find((row) => row.recommended) ?? DATABASE_VERSIONS[kind][0];
	return entry?.version ?? "";
};

/**
 * The curated version an image reference corresponds to, or null when the
 * image is custom (a different repository, a digest, a variant tag). Lets the
 * panel preselect the right option for rows created before `engine_version`
 * existed without guessing.
 */
export const versionFromImage = (kind: DatabaseVersionKind, image: string): string | null => {
	const prefix = `${IMAGE_REPOSITORY[kind]}:`;
	if (!image.startsWith(prefix)) return null;
	const tag = image.slice(prefix.length);
	return isCuratedVersion(kind, tag) ? tag : null;
};

/**
 * Compare two curated versions numerically, component by component
 * (`"8.4" < "9"`, `"10.11" < "11.4"`). Returns a negative number when `a` is
 * older. Only meaningful for tags from {@link DATABASE_VERSIONS}.
 */
export const compareVersions = (a: string, b: string): number => {
	const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
	const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
	for (let i = 0; i < Math.max(left.length, right.length); i++) {
		const diff = (left[i] ?? 0) - (right[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
};

/**
 * Engines whose on-disk format is tied to the major version: the data
 * directory written by one major cannot be opened by another, so the
 * container simply refuses to start after the image changes.
 *
 * - Postgres is the strict case: `PGDATA` carries `PG_VERSION` and the server
 *   exits with "database files are incompatible with server" (this is the
 *   same quirk `postgresPgdata()` works around for the 18 layout change).
 * - MySQL/MariaDB upgrade forward in place (and MariaDB runs
 *   `mariadb-upgrade`), but a downgrade never works.
 * - Mongo requires stepping one major at a time with `setFeatureCompatibilityVersion`.
 * - Redis keeps a version-independent RDB/AOF, so both directions are safe.
 */
export const MAJOR_UPGRADE_RISK: Record<DatabaseVersionKind, boolean> = {
	postgres: true,
	mysql: true,
	mariadb: true,
	mongo: true,
	redis: false,
};

export type VersionChangeVerdict =
	| { kind: "none" }
	| { kind: "allowed" }
	| { kind: "confirm"; reason: string }
	| { kind: "blocked"; reason: string };

/**
 * Classify a version change on an **existing** service.
 *
 * A downgrade is refused outright for the engines above: the data directory
 * is already written in the newer format and the container would crash-loop
 * with no way back except a restore. A major upgrade is allowed but needs an
 * explicit "I have a backup" confirmation, because the same data directory
 * has to be migrated (Postgres will not do it at all — it needs a dump and
 * restore, or `pg_upgrade` run by hand).
 */
export const classifyVersionChange = (
	kind: DatabaseVersionKind,
	from: string | null,
	to: string,
): VersionChangeVerdict => {
	if (!from || from === to) return { kind: "none" };
	if (!MAJOR_UPGRADE_RISK[kind]) return { kind: "allowed" };
	const direction = compareVersions(to, from);
	const majorFrom = from.split(".")[0] ?? from;
	const majorTo = to.split(".")[0] ?? to;
	if (direction < 0) {
		return {
			kind: "blocked",
			reason: `Downgrading ${kind} from ${from} to ${to} is not possible in place: the data directory is already in the newer on-disk format. Create a new service on ${to} and restore a backup into it.`,
		};
	}
	if (majorFrom === majorTo) return { kind: "allowed" };
	return {
		kind: "confirm",
		reason:
			kind === "postgres"
				? `Upgrading Postgres ${from} → ${to} is a major upgrade. The existing pgdata volume was initialised by ${from} and Postgres ${to} will refuse to start on it — take a backup, then restore it into the upgraded service.`
				: `Upgrading ${kind} ${from} → ${to} is a major upgrade and rewrites the data directory. Take a backup first; there is no way back without one.`,
	};
};
