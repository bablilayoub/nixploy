import { describe, expect, it } from "vitest";
import {
	assertLogicalIdentifier,
	assertLogicalNameAvailable,
	buildCreateLogicalCommand,
	buildDropLogicalCommand,
	buildLogicalConnectionUrl,
	generateLogicalPassword,
	type LogicalDatabaseSpec,
	supportsLogicalDatabases,
} from "./logical";

const spec: LogicalDatabaseSpec = {
	name: "analytics",
	username: "analytics_app",
	password: "s3cret-PASSWORD_1",
};

describe("assertLogicalIdentifier", () => {
	it("accepts portable lowercase identifiers", () => {
		for (const value of ["a", "_x", "app_db", "db1", "a".repeat(63)]) {
			expect(assertLogicalIdentifier(value, "database name")).toBe(value);
		}
	});

	it("rejects anything that could change the meaning of the SQL", () => {
		for (const value of [
			"",
			"App",
			"1db",
			"my-db",
			"my db",
			'a"; DROP DATABASE x; --',
			"a`b",
			"a'b",
			"a\nb",
			"a".repeat(64),
		]) {
			expect(() => assertLogicalIdentifier(value, "database name")).toThrow(
				/Invalid database name/,
			);
		}
	});

	it("rejects engine-owned names", () => {
		for (const value of ["postgres", "mysql", "information_schema", "admin", "root"]) {
			expect(() => assertLogicalNameAvailable(value, "database name")).toThrow(/reserved/);
		}
		expect(assertLogicalNameAvailable("analytics", "database name")).toBe("analytics");
	});
});

describe("supportsLogicalDatabases", () => {
	it("covers the four engines with real databases, not redis", () => {
		expect(supportsLogicalDatabases("postgres")).toBe(true);
		expect(supportsLogicalDatabases("mysql")).toBe(true);
		expect(supportsLogicalDatabases("mariadb")).toBe(true);
		expect(supportsLogicalDatabases("mongo")).toBe(true);
		expect(supportsLogicalDatabases("redis")).toBe(false);
	});
});

describe("generateLogicalPassword", () => {
	it("produces a URL-safe password with no shell or SQL metacharacters", () => {
		for (let i = 0; i < 20; i++) {
			const password = generateLogicalPassword();
			expect(password).toMatch(/^[A-Za-z0-9_-]{32,}$/);
		}
	});
});

describe("buildCreateLogicalCommand", () => {
	it("postgres: role then database, with ON_ERROR_STOP", () => {
		const command = buildCreateLogicalCommand("postgres", spec);
		expect(command.shell).toContain("ON_ERROR_STOP=1");
		// Connects over the local socket as the image's superuser — no password
		// on the command line.
		expect(command.shell).not.toContain(spec.password);
		expect(command.stdin).toContain(
			`CREATE ROLE "analytics_app" LOGIN PASSWORD '${spec.password}'`,
		);
		expect(command.stdin).toContain('CREATE DATABASE "analytics" OWNER "analytics_app"');
	});

	it("mysql/mariadb: database, user and grant against the right root env var", () => {
		const mysql = buildCreateLogicalCommand("mysql", spec);
		expect(mysql.shell).toBe('mysql -u root -p"$MYSQL_ROOT_PASSWORD"');
		expect(mysql.stdin).toContain("CREATE DATABASE IF NOT EXISTS `analytics`");
		expect(mysql.stdin).toContain("CREATE USER 'analytics_app'@'%' IDENTIFIED BY");
		expect(mysql.stdin).toContain("GRANT ALL PRIVILEGES ON `analytics`.* TO 'analytics_app'@'%'");

		const mariadb = buildCreateLogicalCommand("mariadb", spec);
		expect(mariadb.shell).toBe('mariadb -u root -p"$MARIADB_ROOT_PASSWORD"');
	});

	it("mongo: dbOwner on that database only, via whichever shell exists", () => {
		const command = buildCreateLogicalCommand("mongo", spec);
		expect(command.shell).toContain("command -v mongosh");
		expect(command.shell).toContain("$MONGO_INITDB_ROOT_PASSWORD");
		expect(command.stdin).toContain('db.getSiblingDB("analytics").createUser(');
		expect(command.stdin).toContain('roles: [{ role: "dbOwner", db: "analytics" }]');
	});

	it("never puts a secret on the host-visible command line", () => {
		for (const kind of ["postgres", "mysql", "mariadb", "mongo"] as const) {
			const command = buildCreateLogicalCommand(kind, spec);
			expect(command.shell).not.toContain(spec.password);
		}
	});

	it("refuses an injected identifier before building anything", () => {
		expect(() =>
			buildCreateLogicalCommand("postgres", { ...spec, name: 'x"; DROP DATABASE postgres; --' }),
		).toThrow(/Invalid database name/);
		expect(() =>
			buildCreateLogicalCommand("mysql", { ...spec, username: "u`; GRANT ALL" }),
		).toThrow(/Invalid username/);
	});
});

describe("buildDropLogicalCommand", () => {
	it("postgres: disconnects sessions, then drops database and role", () => {
		const command = buildDropLogicalCommand("postgres", spec);
		expect(command.stdin).toContain("pg_terminate_backend");
		expect(command.stdin).toContain('DROP DATABASE IF EXISTS "analytics"');
		expect(command.stdin).toContain('DROP ROLE IF EXISTS "analytics_app"');
	});

	it("mysql: drops database and user idempotently", () => {
		const command = buildDropLogicalCommand("mysql", spec);
		expect(command.stdin).toContain("DROP DATABASE IF EXISTS `analytics`");
		expect(command.stdin).toContain("DROP USER IF EXISTS 'analytics_app'@'%'");
	});

	it("mongo: drops the user before the database", () => {
		const command = buildDropLogicalCommand("mongo", spec);
		expect(command.stdin.indexOf("dropUser")).toBeLessThan(command.stdin.indexOf("dropDatabase"));
	});
});

describe("buildLogicalConnectionUrl", () => {
	it("uses the logical credentials and database per engine", () => {
		expect(buildLogicalConnectionUrl("postgres", spec, "pg-abc", 5432)).toBe(
			"postgresql://analytics_app:s3cret-PASSWORD_1@pg-abc:5432/analytics",
		);
		expect(buildLogicalConnectionUrl("mysql", spec, "my-abc", 3306)).toBe(
			"mysql://analytics_app:s3cret-PASSWORD_1@my-abc:3306/analytics",
		);
		expect(buildLogicalConnectionUrl("mongo", spec, "mg-abc", 27017)).toBe(
			"mongodb://analytics_app:s3cret-PASSWORD_1@mg-abc:27017/analytics?authSource=analytics",
		);
	});

	it("percent-encodes credentials", () => {
		const url = buildLogicalConnectionUrl("postgres", { ...spec, password: "a/b@c" }, "host", 5432);
		expect(url).toContain("a%2Fb%40c");
	});
});
