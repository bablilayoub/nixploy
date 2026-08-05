import { z } from "zod";
import { redis } from "../../db/schema";
import { buildDatabaseRouter } from "../../modules/databases/router";

export const redisRouter = buildDatabaseRouter({
	kind: "redis",
	table: redis,
	idColumn: redis.redisId,
	idField: "redisId",
	createFields: {
		databasePassword: z.string().min(1),
	},
});
