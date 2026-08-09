import { describe, expect, it } from "vitest";
import { spawnTargeted } from "./docker";

describe("spawnLocal cancellation", () => {
	it("rejects done as cancelled when killed", async () => {
		const proc = await spawnTargeted(null, "sleep 60");
		proc.kill();
		await expect(proc.done).rejects.toMatchObject({ killed: true });
	});

	it("kills the whole process group, not just the sh wrapper", async () => {
		// The sleep child lives in the shell's process group; killing only the
		// `sh -c` wrapper (the old behavior) would leave it running.
		const proc = await spawnTargeted(null, "sleep 60 & wait");
		const pid = proc.pid;
		expect(pid).toBeTypeOf("number");
		proc.kill();
		await expect(proc.done).rejects.toMatchObject({ killed: true });

		// Give the kernel a beat to reap the group, then probe it.
		await new Promise((resolve) => setTimeout(resolve, 200));
		let groupAlive = true;
		try {
			if (pid) process.kill(-pid, 0);
		} catch {
			groupAlive = false; // ESRCH — the whole group is gone
		}
		expect(groupAlive).toBe(false);
	});

	it("resolves done on exit 0", async () => {
		const proc = await spawnTargeted(null, "true");
		await expect(proc.done).resolves.toBeUndefined();
	});

	it("rejects done on non-zero exit", async () => {
		const proc = await spawnTargeted(null, "exit 3");
		await expect(proc.done).rejects.toMatchObject({ exitCode: 3, killed: false });
	});
});
