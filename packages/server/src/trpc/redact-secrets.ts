/**
 * Strip decrypted secrets from API responses when the caller lacks
 * `secrets.read`. Keep shapes stable (null fields) so clients don't branch on
 * missing keys.
 */

export function redactApplicationSecrets<
	T extends {
		env?: string | null;
		buildArgs?: string | null;
		password?: string | null;
	},
>(row: T): T {
	return { ...row, env: null, buildArgs: null, password: null };
}

export function redactComposeSecrets<T extends { env?: string | null }>(row: T): T {
	return { ...row, env: null };
}

export function redactDatabaseSecrets<T extends Record<string, unknown>>(row: T): T {
	const next: Record<string, unknown> = { ...row, env: null, databasePassword: null };
	if ("databaseRootPassword" in row) {
		next.databaseRootPassword = null;
	}
	return next as T;
}

export function redactDestinationSecrets<T extends { secretAccessKey?: string | null }>(
	destination: T,
): Omit<T, "secretAccessKey"> {
	const { secretAccessKey: _secretAccessKey, ...rest } = destination;
	return rest;
}

export function redactEnvironmentServicesSecrets<
	T extends {
		applications: Array<{
			env?: string | null;
			buildArgs?: string | null;
			password?: string | null;
		}>;
		compose: Array<{ env?: string | null }>;
		postgres: Array<Record<string, unknown>>;
		mysql: Array<Record<string, unknown>>;
		mariadb: Array<Record<string, unknown>>;
		mongo: Array<Record<string, unknown>>;
		redis: Array<Record<string, unknown>>;
	},
>(services: T): T {
	return {
		...services,
		applications: services.applications.map(redactApplicationSecrets),
		compose: services.compose.map(redactComposeSecrets),
		postgres: services.postgres.map(redactDatabaseSecrets),
		mysql: services.mysql.map(redactDatabaseSecrets),
		mariadb: services.mariadb.map(redactDatabaseSecrets),
		mongo: services.mongo.map(redactDatabaseSecrets),
		redis: services.redis.map(redactDatabaseSecrets),
	};
}
