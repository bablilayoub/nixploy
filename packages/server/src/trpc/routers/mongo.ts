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
		// Replica sets need a keyFile + `rs.initiate()` the engine does not
		// provision (mongod refuses `--replSet` with root auth otherwise), so
		// the option is rejected instead of producing a crash-looping service.
		replicaSet: z
			.never({
				error:
					"MongoDB replica sets are not supported by the one-click service — deploy a standalone instance",
			})
			.optional(),
	},
});
