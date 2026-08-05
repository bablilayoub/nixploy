import { z } from "zod";
import { mysql } from "../../db/schema";
import { buildDatabaseRouter } from "../../modules/databases/router";

export const mysqlRouter = buildDatabaseRouter({
	kind: "mysql",
	table: mysql,
	idColumn: mysql.mysqlId,
	idField: "mysqlId",
	createFields: {
		databaseName: z.string().min(1),
		databaseUser: z.string().min(1),
		databasePassword: z.string().min(1),
		databaseRootPassword: z.string().min(1),
	},
});
