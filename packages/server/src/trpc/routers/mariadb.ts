import { z } from "zod";
import { mariadb } from "../../db/schema";
import { buildDatabaseRouter } from "../../modules/databases/router";

export const mariadbRouter = buildDatabaseRouter({
	kind: "mariadb",
	table: mariadb,
	idColumn: mariadb.mariadbId,
	idField: "mariadbId",
	createFields: {
		databaseName: z.string().min(1),
		databaseUser: z.string().min(1),
		databasePassword: z.string().min(1),
		databaseRootPassword: z.string().min(1),
	},
});
