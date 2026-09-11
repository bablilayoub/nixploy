import { z } from "zod";
import { buildDatabaseRouter } from "../../modules/databases/router";

export const mysqlRouter = buildDatabaseRouter({
	kind: "mysql",
	createFields: {
		databaseName: z.string().min(1),
		databaseUser: z.string().min(1),
		databasePassword: z.string().min(1),
		databaseRootPassword: z.string().min(1),
	},
});
