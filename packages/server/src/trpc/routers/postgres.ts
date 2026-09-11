import { z } from "zod";
import { buildDatabaseRouter } from "../../modules/databases/router";

export const postgresRouter = buildDatabaseRouter({
	kind: "postgres",
	createFields: {
		databaseName: z.string().min(1),
		databaseUser: z.string().min(1),
		databasePassword: z.string().min(1),
	},
});
