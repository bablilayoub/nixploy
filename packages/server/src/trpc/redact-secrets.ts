/**
 * Strip decrypted secrets from API responses when the caller lacks
 * `secrets.read`. Keep shapes stable (null fields) so clients don't branch on
 * missing keys.
 */

export function redactApplicationSecrets<T>(row: T): T {
	const source = row as Record<string, unknown>;
	const next: Record<string, unknown> = {
		...source,
		env: null,
		buildArgs: null,
		previewEnv: null,
		password: null,
		dockerfile: null,
		command: null,
		// Hook commands are shell, and shell carries credentials just as often
		// as `command` does.
		preDeployCommand: null,
		postDeployCommand: null,
	};
	const environment = source.environment as
		| ({ env?: string | null; project?: Record<string, unknown> } & Record<string, unknown>)
		| null
		| undefined;
	if (environment && typeof environment === "object") {
		const project = environment.project
			? { ...environment.project, env: null }
			: environment.project;
		next.environment = { ...environment, env: null, project };
	}
	return next as T;
}

export function redactComposeSecrets<T>(row: T): T {
	const source = row as Record<string, unknown>;
	const next: Record<string, unknown> = {
		...source,
		env: null,
		composeFile: null,
		preDeployCommand: null,
		postDeployCommand: null,
	};
	const environment = source.environment as
		| ({ env?: string | null; project?: Record<string, unknown> } & Record<string, unknown>)
		| null
		| undefined;
	if (environment && typeof environment === "object") {
		const project = environment.project
			? { ...environment.project, env: null }
			: environment.project;
		next.environment = { ...environment, env: null, project };
	}
	return next as T;
}

export function redactDatabaseSecrets<T extends Record<string, unknown>>(row: T): T {
	const next: Record<string, unknown> = {
		...row,
		env: null,
		databasePassword: null,
		command: null,
	};
	if ("databaseRootPassword" in row) {
		next.databaseRootPassword = null;
	}
	return next as T;
}

export function redactDestinationSecrets<
	T extends { secretAccessKey?: string | null; accessKey?: string | null },
>(
	destination: T,
): Omit<T, "secretAccessKey" | "accessKey"> & {
	accessKey: null;
	accessKeyConfigured: boolean;
} {
	const { secretAccessKey: _secretAccessKey, accessKey, ...rest } = destination;
	return {
		...(rest as Omit<T, "secretAccessKey" | "accessKey">),
		accessKey: null,
		accessKeyConfigured: Boolean(accessKey),
	};
}

export function redactScheduleSecrets<
	T extends { command?: string | null; script?: string | null },
>(row: T): T {
	return { ...row, command: null, script: null };
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
