import { z } from "zod";
import { postgres } from "../../db/schema";
import { buildDatabaseRouter } from "../../modules/databases/router";

export const postgresRouter = buildDatabaseRouter({
	kind: "postgres",
	table: postgres,
	idColumn: postgres.postgresId,
	idField: "postgresId",
	createFields: {
		databaseName: z.string().min(1),
		databaseUser: z.string().min(1),
		databasePassword: z.string().min(1),
	},
});
