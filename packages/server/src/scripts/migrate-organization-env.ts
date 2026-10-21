/** One-off backfill while the host updater keeps every platform role stopped. */
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { client } from "../db";
import { migrateOrganizationEnvironments } from "../modules/projects/organization-env";
import { execAsync } from "../utils/exec";

// Development/process installs have no platform Swarm service to drain. This
// explicit operator assertion is separate from the verified host updater path.
if (process.env.NIXPLOY_OFFLINE_UPGRADE !== undefined) {
	if (process.env.NIXPLOY_OFFLINE_UPGRADE !== "stopped-all-roles-and-backed-up-0048") {
		throw new Error("Stop every panel/worker and back up the database, config and keys first");
	}
	const services = await execAsync("docker service ls --format '{{.Name}}'", { timeout: 15_000 });
	if (services.split(/\s+/).some((name) => name === "nixploy" || name === "nixploy-worker")) {
		throw new Error("Use the current host update.sh for a Swarm platform install");
	}
	if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
	const migrationClient = postgres(process.env.DATABASE_URL, { max: 1 });
	try {
		const [connections] = await migrationClient`
			select count(*)::int as count from pg_stat_activity
			where datname = current_database() and pid <> pg_backend_pid() and backend_type = 'client backend'
		`;
		if (connections?.count !== 0) {
			throw new Error("Other database clients remain connected; stop all roles before migrating");
		}
		await migrationClient`select set_config('nixploy.upgrade_0048_drained','1',false)`;
		await migrate(drizzle(migrationClient), {
			migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
		});
	} finally {
		await migrationClient.end();
	}
}

try {
	const result = await migrateOrganizationEnvironments();
	console.log(
		`Encrypted organization-variable backfill complete (${result.migrated} organization(s))`,
	);
} finally {
	await client.end();
}
