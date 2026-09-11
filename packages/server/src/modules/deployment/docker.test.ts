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

describe("spawnLocal timeout", () => {
	it("kills the whole tree and rejects as a failure (not a cancellation) when the timeout expires", async () => {
		const startedAt = Date.now();
		const proc = await spawnTargeted(null, "sleep 60 & wait", { timeoutMs: 100 });
		const pid = proc.pid;
		await expect(proc.done).rejects.toMatchObject({
			killed: false,
			message: expect.stringMatching(/^Command timed out after 0s/),
		});
		// A hung build must not wait for the child to exit on its own.
		expect(Date.now() - startedAt).toBeLessThan(5_000);

		await new Promise((resolve) => setTimeout(resolve, 200));
		let groupAlive = true;
		try {
			if (pid) process.kill(-pid, 0);
		} catch {
			groupAlive = false;
		}
		expect(groupAlive).toBe(false);
	});

	it("does not fire for commands that finish in time", async () => {
		const proc = await spawnTargeted(null, "true", { timeoutMs: 5_000 });
		await expect(proc.done).resolves.toBeUndefined();
	});
});
