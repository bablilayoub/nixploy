import { describe, expect, it } from "vitest";
import { DB_DUMP_CONFIG, type DumpCommandParams } from "./dump-commands";

const params: DumpCommandParams = {
	database: "app_db",
	databaseUser: "app_user",
	databasePassword: "s3cret",
	databaseRootPassword: "root-pass",
};

describe("DB_DUMP_CONFIG", () => {
	it("covers every supported database type", () => {
		expect(Object.keys(DB_DUMP_CONFIG).sort()).toEqual(["mariadb", "mongo", "mysql", "postgres"]);
	});

	it("every engine has an extension plus dump and restore commands", () => {
		for (const [type, config] of Object.entries(DB_DUMP_CONFIG)) {
			expect(["sql", "archive"], `${type} extension`).toContain(config.extension);
			expect(typeof config.dumpCommand(params), `${type} dump`).toBe("string");
			expect(typeof config.restoreCommand(params), `${type} restore`).toBe("string");
			expect(config.dumpCommand(params).length).toBeGreaterThan(0);
			expect(config.restoreCommand(params).length).toBeGreaterThan(0);
		}
	});

	it("postgres uses pg_dump/psql with the database and user", () => {
		const config = DB_DUMP_CONFIG.postgres;
		expect(config.extension).toBe("sql");
		expect(config.dumpCommand(params)).toBe(
			"pg_dump -U 'app_user' -d 'app_db' --no-owner --no-privileges",
		);
		expect(config.restoreCommand(params)).toBe("psql -U 'app_user' -d 'app_db' -v ON_ERROR_STOP=1");
	});

	it("mysql never puts the password on argv", () => {
		const config = DB_DUMP_CONFIG.mysql;
		expect(config.extension).toBe("sql");
		expect(config.passwordEnv?.(params)).toEqual({ MYSQL_PWD: "s3cret" });
		expect(config.dumpCommand(params)).toContain("mysqldump");
		expect(config.dumpCommand(params)).not.toContain("s3cret");
		expect(config.dumpCommand(params)).not.toMatch(/-p/);
		expect(config.dumpCommand(params)).toContain("--databases 'app_db'");
		expect(config.restoreCommand(params)).toContain("mysql");
		expect(config.restoreCommand(params)).not.toContain("s3cret");
	});

	it("mariadb uses mariadb-dump/mariadb without argv passwords", () => {
		const config = DB_DUMP_CONFIG.mariadb;
		expect(config.extension).toBe("sql");
		expect(config.passwordEnv?.(params)).toEqual({ MYSQL_PWD: "s3cret" });
		expect(config.dumpCommand(params)).toContain("mariadb-dump");
		expect(config.dumpCommand(params)).not.toContain("s3cret");
		expect(config.restoreCommand(params)).toContain("mariadb");
		expect(config.restoreCommand(params)).not.toContain("mariadb-dump");
	});

	it("mongo streams an archive with admin auth via env password", () => {
		const config = DB_DUMP_CONFIG.mongo;
		expect(config.extension).toBe("archive");
		expect(config.passwordEnv?.(params)).toEqual({ MONGO_PASSWORD: "s3cret" });
		expect(config.dumpCommand(params)).toContain("mongodump");
		expect(config.dumpCommand(params)).toContain("--archive");
		expect(config.dumpCommand(params)).toContain("$MONGO_PASSWORD");
		expect(config.dumpCommand(params)).not.toContain("s3cret");
		expect(config.restoreCommand(params)).toContain("mongorestore");
		expect(config.restoreCommand(params)).toContain("--drop");
	});

	it("shell-quotes values containing spaces and single quotes", () => {
		const nasty: DumpCommandParams = {
			database: "weird db",
			databaseUser: "us'er",
			databasePassword: "p a'ss",
		};
		const dump = DB_DUMP_CONFIG.postgres.dumpCommand(nasty);
		// POSIX single-quote escaping: ' → '\''
		expect(dump).toContain(`-d 'weird db'`);
		expect(dump).toContain(`-U 'us'\\''er'`);
		const mysqlDump = DB_DUMP_CONFIG.mysql.dumpCommand(nasty);
		expect(mysqlDump).not.toContain("p a");
		expect(mysqlDump).toContain(`-u 'us'\\''er'`);
	});
});
