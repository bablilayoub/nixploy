import { Duplex, PassThrough, Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/ssh-pool", () => ({ acquireSsh: vi.fn() }));

import { acquireSsh } from "../../utils/ssh-pool";
import { assertStreamExit, buildStreamPipeline } from "./pipeline";
import { spawnStreamingCommand } from "./stream-exec";

async function drain(command: Awaited<ReturnType<typeof spawnStreamingCommand>>) {
	const chunks: Buffer[] = [];
	for await (const chunk of command.stdout) chunks.push(Buffer.from(chunk));
	const stderr = await command.done;
	return { stdout: Buffer.concat(chunks), stderr };
}

describe("streaming backup command", () => {
	it("drains more than the old 50 MiB exec ceiling with bounded chunks", async () => {
		const command = await spawnStreamingCommand(null, "head -c 67108864 /dev/zero");
		let bytes = 0;
		for await (const chunk of command.stdout) bytes += chunk.length;
		await command.done;
		expect(bytes).toBe(64 * 1024 * 1024);
	});
	it("streams binary stdin and stdout without encoding", async () => {
		const bytes = Buffer.from([0, 255, 13, 10, 128]);
		const command = await spawnStreamingCommand(null, "cat", { stdin: Readable.from([bytes]) });
		expect((await drain(command)).stdout).toEqual(bytes);
	});

	it("rejects a source stream failure without an unhandled error", async () => {
		const source = Readable.from(
			(async function* () {
				yield Buffer.from("partial");
				throw new Error("source read failed");
			})(),
		);
		const command = await spawnStreamingCommand(null, "cat >/dev/null", { stdin: source });
		command.stdout.resume();
		await expect(command.done).rejects.toThrow("source read failed");
	});

	it("rejects a signalled producer rather than accepting a null exit code", async () => {
		const command = await spawnStreamingCommand(null, "kill -TERM $$");
		await expect(drain(command)).rejects.toThrow(/signal SIGTERM/);
	});

	it("rejects a consumer that exits before consuming its source", async () => {
		const command = await spawnStreamingCommand(null, "exit 0", {
			stdin: Readable.from([Buffer.alloc(1024 * 1024)]),
		});
		await expect(drain(command)).rejects.toThrow();
	});

	it("retains the final producer trailer after verbose stderr", async () => {
		const command = await spawnStreamingCommand(
			null,
			buildStreamPipeline("printf noise >&2; printf payload"),
			{ maxStderrBytes: 32 },
		);
		const output = await drain(command);
		expect(() => assertStreamExit(output.stderr, "Dump")).not.toThrow();
	});

	it("carries local credentials in the environment only", async () => {
		const command = await spawnStreamingCommand(null, "printf '%s' \"$NIXPLOY_TEST_PASSWORD\"", {
			env: { NIXPLOY_TEST_PASSWORD: "test-only-secret" },
		});
		expect((await drain(command)).stdout.toString()).toBe("test-only-secret");
	});
});

describe("remote streaming command", () => {
	it.each([0, null, 9])("accepts only an explicit remote zero exit (%s)", async (code) => {
		const channel = new Duplex({
			read() {},
			write(_chunk, _encoding, callback) {
				callback();
			},
		});
		const close = vi.fn();
		Object.assign(channel, { stderr: new PassThrough(), close });
		const release = vi.fn();
		vi.mocked(acquireSsh).mockResolvedValue({
			server: { name: "test-server" },
			release,
			discard: vi.fn(),
			onConnectionLost: vi.fn(),
			client: {
				exec(_command: string, callback: (error: null, value: unknown) => void) {
					callback(null, channel);
					setImmediate(() => {
						channel.push(null);
						channel.emit("close", code);
					});
				},
			},
		} as never);
		const command = await spawnStreamingCommand("test-server", "unused fake command");
		if (code === 0) await expect(drain(command)).resolves.toBeDefined();
		else await expect(drain(command)).rejects.toThrow(/Backup command failed/);
		expect(release).toHaveBeenCalled();
	});
});
