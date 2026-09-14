import { describe, expect, it } from "vitest";
import { appRouter } from "../../trpc/root";

const inputSchemaOf = (path: string) => {
	const procedure = (appRouter._def.procedures as Record<string, unknown>)[path] as {
		_def: { inputs: Array<{ parse: (value: unknown) => unknown }> };
	};
	const schema = procedure._def.inputs[0];
	if (!schema) throw new Error(`no input schema for ${path}`);
	return schema;
};

describe("database update input", () => {
	it("does not fill in the default image on a partial update", () => {
		// Regression: renaming a Postgres 18 instance failed with "Downgrading
		// postgres from 18 to 17 is not possible in place" because the update
		// schema inherited the create-time default image.
		const parsed = inputSchemaOf("postgres.update").parse({
			postgresId: "pg_1",
			name: "renamed",
		}) as Record<string, unknown>;
		expect(parsed).not.toHaveProperty("dockerImage");
		expect(parsed).not.toHaveProperty("engineVersion");
	});

	it("still accepts an explicit image or version", () => {
		const parsed = inputSchemaOf("mysql.update").parse({
			mysqlId: "my_1",
			dockerImage: "mysql:8.4",
		}) as Record<string, unknown>;
		expect(parsed.dockerImage).toBe("mysql:8.4");
	});

	it("keeps the default image on create", () => {
		const parsed = inputSchemaOf("postgres.create").parse({
			name: "db",
			environmentId: "env_1",
			databaseName: "app",
			databaseUser: "app",
			databasePassword: "secret-password",
		}) as Record<string, unknown>;
		expect(typeof parsed.dockerImage).toBe("string");
	});
});
