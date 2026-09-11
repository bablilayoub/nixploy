import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { serviceType } from "../../db/schema";
import {
	assertServiceTypeEnumMatchesKinds,
	DATABASE_KIND_CREDENTIALS,
	DATABASE_KINDS,
	databaseDef,
	isDatabaseServiceKind,
	isServiceKind,
	SERVICE_DEFS,
	SERVICE_KIND_ID_FIELDS,
	SERVICE_KIND_LABELS,
	SERVICE_KINDS,
	SERVICE_REGISTRY,
	serviceDef,
	serviceIdField,
	serviceKindSchema,
} from "./registry";

describe("service kind tuple", () => {
	it("matches the service_type pgEnum", () => {
		// The guard runs at import time; assert it directly so a mismatch is
		// reported as a failing test and not as a module that will not load.
		expect([...serviceType.enumValues].sort()).toEqual([...SERVICE_KINDS].sort());
		expect(() => assertServiceTypeEnumMatchesKinds()).not.toThrow();
	});

	it("derives the zod enum from the tuple", () => {
		expect(serviceKindSchema.options).toEqual([...SERVICE_KINDS]);
		expect(serviceKindSchema.safeParse("postgres").success).toBe(true);
		expect(serviceKindSchema.safeParse("web-server").success).toBe(false);
	});

	it("treats the five database engines as a subset", () => {
		for (const kind of DATABASE_KINDS) {
			expect(SERVICE_KINDS).toContain(kind);
			expect(isDatabaseServiceKind(kind)).toBe(true);
			expect(DATABASE_KIND_CREDENTIALS[kind]).toBeDefined();
		}
		expect(isDatabaseServiceKind("application")).toBe(false);
		expect(isDatabaseServiceKind("compose")).toBe(false);
	});

	it("guards untrusted strings", () => {
		expect(isServiceKind("redis")).toBe(true);
		expect(isServiceKind("Redis")).toBe(false);
		expect(isServiceKind(null)).toBe(false);
	});

	it("names every id field `<kind>Id`", () => {
		for (const kind of SERVICE_KINDS) {
			expect(SERVICE_KIND_ID_FIELDS[kind]).toBe(`${kind}Id`);
			expect(serviceIdField(kind)).toBe(`${kind}Id`);
		}
	});

	it("labels every kind", () => {
		for (const kind of SERVICE_KINDS) {
			expect(SERVICE_KIND_LABELS[kind]).toBeTruthy();
		}
	});
});

describe("SERVICE_REGISTRY", () => {
	it("has one entry per kind, in tuple order", () => {
		expect(Object.keys(SERVICE_REGISTRY)).toEqual([...SERVICE_KINDS]);
		expect(SERVICE_DEFS.map((def) => def.kind)).toEqual([...SERVICE_KINDS]);
	});

	it("wires each entry to its own table, id column and tag table", () => {
		const tableNames = new Set<string>();
		const tagTableNames = new Set<string>();
		for (const kind of SERVICE_KINDS) {
			const def = SERVICE_REGISTRY[kind];
			expect(def.kind).toBe(kind);
			expect(def.idField).toBe(`${kind}Id`);
			expect(def.idColumn.name).toBeTruthy();
			expect(def.label).toBe(SERVICE_KIND_LABELS[kind]);
			expect(def.isDatabase).toBe(isDatabaseServiceKind(kind));
			tableNames.add(getTableName(def.table));
			tagTableNames.add(getTableName(def.tagTable));
		}
		expect(tableNames.size).toBe(SERVICE_KINDS.length);
		expect(tagTableNames.size).toBe(SERVICE_KINDS.length);
	});

	it("gives the five engines a backup FK and the other two none", () => {
		for (const kind of SERVICE_KINDS) {
			const def = SERVICE_REGISTRY[kind];
			if (def.isDatabase) {
				expect(def.backupColumn?.name).toBeTruthy();
			} else {
				expect(def.backupColumn).toBeNull();
			}
		}
	});

	it("exposes the same module surface for every kind", () => {
		const surface = Object.keys(SERVICE_REGISTRY.application.module).sort();
		expect(surface).toContain("findById");
		expect(surface).toContain("findTenancy");
		expect(surface).toContain("setTags");
		for (const kind of SERVICE_KINDS) {
			expect(Object.keys(SERVICE_REGISTRY[kind].module).sort()).toEqual(surface);
		}
	});

	it("reads a row's primary key through `rowId`", () => {
		expect(
			SERVICE_REGISTRY.postgres.module.rowId({
				postgresId: "pg_1",
			} as Parameters<typeof SERVICE_REGISTRY.postgres.module.rowId>[0]),
		).toBe("pg_1");
	});

	it("widens a runtime kind back to one callable entry", () => {
		const kind: (typeof SERVICE_KINDS)[number] = "mysql";
		expect(serviceDef(kind).idField).toBe("mysqlId");
		expect(databaseDef("mongo").isDatabase).toBe(true);
	});
});
