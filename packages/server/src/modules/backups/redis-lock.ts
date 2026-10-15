import postgres from "postgres";

/**
 * A session lock serializes different schedules/processes for one Redis.
 * Use a dedicated connection: holding the shared pool's few connections
 * during SSH/storage work could starve the queries those operations need.
 */
export async function withRedisBackupLock<T>(
	redisId: string,
	work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
	if (!process.env.DATABASE_URL)
		throw new Error("DATABASE_URL is required for the Redis backup lock");
	const controller = new AbortController();
	let holding = false;
	const sql = postgres(process.env.DATABASE_URL, {
		max: 1,
		prepare: false,
		onclose() {
			if (holding) controller.abort(new Error("Redis backup lock connection was lost"));
		},
	});
	let connection: Awaited<ReturnType<typeof sql.reserve>> | undefined;
	try {
		connection = await sql.reserve();
		const [row] =
			await connection`select pg_try_advisory_lock(hashtext('nixploy.redis.backup'), hashtext(${redisId})) as acquired`;
		if (!row?.acquired) throw new Error("Another backup of this Redis service is already running");
		holding = true;
		const result = await work(controller.signal);
		controller.signal.throwIfAborted();
		return result;
	} finally {
		try {
			if (holding && !controller.signal.aborted && connection)
				await connection`select pg_advisory_unlock(hashtext('nixploy.redis.backup'), hashtext(${redisId}))`;
		} finally {
			holding = false;
			connection?.release();
			await sql.end({ timeout: 5 });
		}
	}
}
