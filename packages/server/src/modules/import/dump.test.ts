import { describe, expect, it } from "vitest";
import { resolveTableNames } from "./dump";
import { sniffDump } from "./dump-store";

describe("offline importer", () => {
	it("recognises pg_dump plain, gzipped and custom dumps and refuses the rest", () => {
		expect(sniffDump(Buffer.from("--\n-- PostgreSQL database dump\n--\n"))).toEqual({
			format: "plain",
			gzipped: false,
		});
		expect(sniffDump(Buffer.from([0x1f, 0x8b, 0x08, 0x00]))).toEqual({
			format: "plain",
			gzipped: true,
		});
		expect(sniffDump(Buffer.from("PGDMP\x01\x0e"))).toEqual({ format: "custom", gzipped: false });
		expect(() => sniffDump(Buffer.from("<html>not a dump"))).toThrow(/Not a PostgreSQL dump/);
		expect(() => sniffDump(Buffer.from("PK\x03\x04"))).toThrow(/Not a PostgreSQL dump/);
	});

	it("picks the source's table names from the restored schema, tolerating renames", () => {
		const tables = resolveTableNames([
			"project",
			"environment",
			"application",
			"compose",
			"domain",
			"mount",
			"port",
			"redirects",
			"security",
			"postgres",
			"redis",
			"unrelated",
		]);
		expect(tables).toMatchObject({
			project: "project",
			redirect: "redirects",
			security: "security",
			databases: { postgres: "postgres", redis: "redis" },
		});
		expect(tables.databases.mysql).toBeUndefined();
		expect(
			resolveTableNames(["projects", "environments", "applications", "composes"]).compose,
		).toBe("composes");
		expect(() => resolveTableNames(["project", "environment"])).toThrow(/no "application" table/);
	});
});
