import { z } from "zod";
import { buildDatabaseRouter } from "../../modules/databases/router";

export const redisRouter = buildDatabaseRouter({
	kind: "redis",
	createFields: {
		databasePassword: z.string().min(1),
	},
});
