import { z } from "zod";
import { mongo } from "../../db/schema";
import { buildDatabaseRouter } from "../../modules/databases/router";

export const mongoRouter = buildDatabaseRouter({
	kind: "mongo",
	table: mongo,
	idColumn: mongo.mongoId,
	idField: "mongoId",
	createFields: {
		databaseUser: z.string().min(1),
		databasePassword: z.string().min(1),
		replicaSet: z.string().optional(),
	},
});
