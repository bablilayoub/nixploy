import { z } from "zod";
import { buildDatabaseRouter } from "../../modules/databases/router";

export const mariadbRouter = buildDatabaseRouter({
	kind: "mariadb",
	createFields: {
		databaseName: z.string().min(1),
		databaseUser: z.string().min(1),
		databasePassword: z.string().min(1),
		databaseRootPassword: z.string().min(1),
	},
});
