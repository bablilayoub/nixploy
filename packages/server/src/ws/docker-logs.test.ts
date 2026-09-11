import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/ws/logs` fan-out (audit #20): every viewer of one container used to open
 * its own `docker logs --follow` — and, on a managed server, its own SSH
 * session. The follow is now shared and ref-counted.
 */

const { docker, ssh } = vi.hoisted(() => ({
	docker: { logsCalls: 0, destroyed: 0, streams: [] as Array<{ push: (chunk: string) => void }> },
	ssh: { connects: 0, execs: 0, ends: 0 },
}));

vi.mock("./access", () => ({
	assertWsContainerAccess: async () => {},
	assertWsDockerContainerAccess: async () => {},
}));

vi.mock("../modules/compose/containers", () => ({
	assertComposeContainerOwnership: async () => {},
}));

vi.mock("./docker", () => {
	const makeContainer = (id: string) => ({
		id,
		inspect: async () => ({ Config: { Tty: true } }),
		logs: async () => {
			docker.logsCalls += 1;
			const stream = new Readable({ read() {} });
			const original = stream.destroy.bind(stream);
			stream.destroy = ((...args: unknown[]) => {
				docker.destroyed += 1;
				return original(...(args as []));
			}) as typeof stream.destroy;
			docker.streams.push({ push: (chunk: string) => stream.push(Buffer.from(chunk)) });
			return stream;
		},
	});
	return {
		resolveLocalContainer: async (appName: string) => makeContainer(`c-${appName}`),
		resolveLocalContainerById: async (id: string) => makeContainer(id),
		resolveRemoteContainerId: async () => "remote-container",
		assertContainerNotProtected: async () => {},
		getDocker: () => ({ modem: { demuxStream: () => {} } }),
		connectToServer: async () => {
			ssh.connects += 1;
			return {
				exec: (_command: string, callback: (err: Error | null, stream: unknown) => void) => {
					ssh.execs += 1;
					const stream = Object.assign(new EventEmitter(), { close: () => {} });
					callback(null, stream);
				},
				end: () => {
					ssh.ends += 1;
				},
			};
		},
	};
});

import { handleDockerLogs, sharedLogStreamCount } from "./docker-logs";

/** Minimal WebSocket stand-in: records frames, fires `close` listeners. */
class FakeSocket extends EventEmitter {
	readonly OPEN = 1;
	readyState = 1;
	bufferedAmount = 0;
	sent: string[] = [];
	closedWith: number | null = null;

	send(data: string | Buffer): void {
		this.sent.push(data.toString());
	}
	close(code?: number): void {
		this.closedWith = code ?? 1000;
		this.readyState = 3;
		this.emit("close");
	}
	terminate(): void {
		this.close(1011);
	}
}

const request = (query: string): IncomingMessage =>
	({ url: `/ws/logs?${query}`, headers: { host: "localhost" } }) as IncomingMessage;

const session = {} as never;

const connect = (socket: FakeSocket, query: string) =>
	handleDockerLogs(
		socket as unknown as Parameters<typeof handleDockerLogs>[0],
		request(query),
		session,
	);

beforeEach(() => {
	docker.logsCalls = 0;
	docker.destroyed = 0;
	docker.streams = [];
	ssh.connects = 0;
	ssh.execs = 0;
	ssh.ends = 0;
});

describe("shared local log streams", () => {
	it("opens one docker logs follow for several viewers of one container", async () => {
		const a = new FakeSocket();
		const b = new FakeSocket();
		await connect(a, "appName=shop");
		await connect(b, "appName=shop");

		expect(docker.logsCalls).toBe(1);
		expect(sharedLogStreamCount()).toBe(1);

		docker.streams[0]?.push("hello\n");
		await new Promise((resolve) => setImmediate(resolve));
		expect(a.sent).toEqual(["hello\n"]);
		expect(b.sent).toEqual(["hello\n"]);
		a.close();
		b.close();
	});

	it("replays what the shared stream already captured to a late joiner", async () => {
		const a = new FakeSocket();
		await connect(a, "appName=shop");
		docker.streams[0]?.push("first\n");
		await new Promise((resolve) => setImmediate(resolve));

		const b = new FakeSocket();
		await connect(b, "appName=shop");
		expect(b.sent).toEqual(["first\n"]);

		docker.streams[0]?.push("second\n");
		await new Promise((resolve) => setImmediate(resolve));
		// Exactly once each — never replayed AND fanned out.
		expect(b.sent).toEqual(["first\n", "second\n"]);
		expect(a.sent).toEqual(["first\n", "second\n"]);
		a.close();
		b.close();
	});

	it("keeps following until the last viewer leaves, then stops", async () => {
		const a = new FakeSocket();
		const b = new FakeSocket();
		await connect(a, "appName=shop");
		await connect(b, "appName=shop");

		a.close();
		expect(sharedLogStreamCount()).toBe(1);
		expect(docker.destroyed).toBe(0);

		b.close();
		expect(sharedLogStreamCount()).toBe(0);
		expect(docker.destroyed).toBe(1);
	});

	it("keeps different tail sizes on their own stream", async () => {
		const a = new FakeSocket();
		const b = new FakeSocket();
		await connect(a, "appName=shop&tail=100");
		await connect(b, "appName=shop&tail=500");

		expect(docker.logsCalls).toBe(2);
		expect(sharedLogStreamCount()).toBe(2);
		a.close();
		b.close();
	});
});

describe("shared remote log streams", () => {
	it("opens one SSH session per container, not per viewer", async () => {
		const a = new FakeSocket();
		const b = new FakeSocket();
		await connect(a, "containerId=abc123def456&serverId=srv-1");
		await connect(b, "containerId=abc123def456&serverId=srv-1");

		expect(ssh.execs).toBe(1);
		expect(sharedLogStreamCount()).toBe(1);

		a.close();
		b.close();
		expect(sharedLogStreamCount()).toBe(0);
		// The follow session is closed with the last viewer.
		expect(ssh.ends).toBeGreaterThanOrEqual(1);
	});
});
