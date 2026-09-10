import { describe, expect, it } from "vitest";
import {
	buildConfigArchiveCommand,
	buildInstanceContainerDumpCommand,
	buildInstanceContainerFilters,
	buildInstancePgDumpCommand,
	buildRedisSnapshotScript,
	CONFIG_ARCHIVE_EXCLUDES,
	isSafeRedisDataDir,
	parseInstanceDatabaseUrl,
} from "./instance-backup";

describe("parseInstanceDatabaseUrl", () => {
	it("parses a full postgres URL, decoding user and password", () => {
		const target = parseInstanceDatabaseUrl(
			"postgres://nixploy:p%40ss%2Fword@db.internal:5544/platform",
		);
		expect(target).toEqual({
			user: "nixploy",
			password: "p@ss/word",
			host: "db.internal",
			port: "5544",
			database: "platform",
		});
	});

	it("accepts the postgresql:// scheme and defaults port/user", () => {
		const target = parseInstanceDatabaseUrl("postgresql://nixploy-postgres/nixploy");
		expect(target.port).toBe("5432");
		expect(target.user).toBe("postgres");
		expect(target.host).toBe("nixploy-postgres");
		expect(target.database).toBe("nixploy");
	});

	it("rejects a missing DATABASE_URL", () => {
		expect(() => parseInstanceDatabaseUrl(undefined)).toThrow("DATABASE_URL is not set");
	});

	it("rejects a malformed URL", () => {
		expect(() => parseInstanceDatabaseUrl("not a url")).toThrow("not a valid URL");
	});

	it("rejects non-postgres schemes", () => {
		expect(() => parseInstanceDatabaseUrl("mysql://u:p@host/db")).toThrow("postgres://");
		expect(() => parseInstanceDatabaseUrl("redis://localhost:6379")).toThrow("postgres://");
	});

	it("rejects URLs without a database name", () => {
		expect(() => parseInstanceDatabaseUrl("postgres://u:p@host:5432/")).toThrow(
			"host and a database name",
		);
	});
});

describe("buildInstancePgDumpCommand", () => {
	const target = parseInstanceDatabaseUrl("postgres://nixploy:s3cret@nixploy-postgres/nixploy");

	it("targets host, port, user and database without the password on argv", () => {
		const command = buildInstancePgDumpCommand(target);
		expect(command).toBe(
			"pg_dump -h 'nixploy-postgres' -p '5432' -U 'nixploy' -d 'nixploy' --no-owner --no-privileges",
		);
		expect(command).not.toContain("s3cret");
		expect(command).not.toContain("PGPASSWORD");
	});

	it("shell-quotes hostile values", () => {
		const nasty = buildInstancePgDumpCommand(
			parseInstanceDatabaseUrl("postgres://us'er:p@ho'st/db;rm"),
		);
		expect(nasty).toContain(`-U 'us'\\''er'`);
		expect(nasty).toContain(`-h 'ho'\\''st'`);
		expect(nasty).toContain(`-d 'db;rm'`);
	});
});

describe("instance container fallback", () => {
	it("looks the Postgres container up by swarm service, compose service and name", () => {
		const filters = buildInstanceContainerFilters("nixploy-postgres");
		expect(filters).toHaveLength(3);
		expect(filters[0]).toContain("com.docker.swarm.service.name=nixploy-postgres");
		expect(filters[1]).toContain("com.docker.compose.service=nixploy-postgres");
		expect(filters[2]).toContain("name=^/nixploy-postgres$");
	});

	it("runs pg_dump inside the container without a password (trust auth)", () => {
		const target = parseInstanceDatabaseUrl("postgres://nixploy:s3cret@postgres:5432/nixploy");
		const command = buildInstanceContainerDumpCommand(target);
		expect(command).toBe("pg_dump -U 'nixploy' -d 'nixploy' --no-owner --no-privileges");
		expect(command).not.toContain("s3cret");
	});
});

describe("buildConfigArchiveCommand", () => {
	it("tars the config dir to stdout, excluding derived/heavy subtrees", () => {
		const command = buildConfigArchiveCommand("/etc/nixploy");
		expect(command).toMatch(/^tar czf - -C '\/etc\/nixploy' /);
		expect(command).toContain(" .");
		for (const dir of CONFIG_ARCHIVE_EXCLUDES) {
			expect(command).toContain(`--exclude='./${dir}'`);
		}
		// The pieces an instance restore actually needs stay in.
		expect(command).not.toContain("--exclude='./traefik'");
		expect(command).not.toContain("--exclude='./ssh'");
	});

	it("never ships the panel's own secrets file next to the dump it protects", () => {
		const command = buildConfigArchiveCommand("/etc/nixploy");
		// install.sh writes ENCRYPTION_KEY / BETTER_AUTH_SECRET / DATABASE_URL /
		// POSTGRES_PASSWORD to <configDir>/.env; a bucket reader must not get
		// the ciphertexts (pg_dump) and the key (archive) in the same run.
		expect(command).toContain("--exclude='./.env'");
		expect(command).toContain("--exclude='./.env.*'");
		expect(CONFIG_ARCHIVE_EXCLUDES).toContain(".env");
		expect(CONFIG_ARCHIVE_EXCLUDES).toContain(".env.*");
	});

	it("shell-quotes a config dir with spaces", () => {
		expect(buildConfigArchiveCommand("/opt/my nixploy")).toContain("-C '/opt/my nixploy'");
	});
});

describe("buildRedisSnapshotScript", () => {
	it("reads the password from stdin and never inlines it", () => {
		const script = buildRedisSnapshotScript();
		expect(script).toContain("IFS= read -r REDISCLI_AUTH");
		expect(script).toContain("export REDISCLI_AUTH");
		expect(script).toContain("--no-auth-warning");
	});

	it("triggers BGSAVE with a blocking SAVE fallback and waits for persistence", () => {
		const script = buildRedisSnapshotScript();
		expect(script).toContain("BGSAVE");
		expect(script).toContain("|| redis-cli --no-auth-warning SAVE");
		expect(script).toContain("rdb_bgsave_in_progress");
		expect(script).toContain("rdb_last_bgsave_status");
		expect(script).toContain("CONFIG GET dir");
	});

	it("honors the max wait budget", () => {
		expect(buildRedisSnapshotScript(30)).toContain("$i -lt 30");
	});
});

describe("isSafeRedisDataDir", () => {
	it("accepts plain absolute paths", () => {
		expect(isSafeRedisDataDir("/data")).toBe(true);
		expect(isSafeRedisDataDir("/var/lib/redis")).toBe(true);
	});

	it("rejects empty, relative and shell-injecting values", () => {
		expect(isSafeRedisDataDir("")).toBe(false);
		expect(isSafeRedisDataDir("data")).toBe(false);
		expect(isSafeRedisDataDir("/data; rm -rf /")).toBe(false);
		expect(isSafeRedisDataDir("/data foo")).toBe(false);
		expect(isSafeRedisDataDir("/data/$(reboot)")).toBe(false);
		expect(isSafeRedisDataDir("/../etc")).toBe(false);
	});
});
