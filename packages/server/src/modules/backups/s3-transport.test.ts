import { execFileSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	type S3Client,
} from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

import { setPrivateEgressAllowedForTests } from "../../utils/public-url";
import { uploadStream } from "./s3";
import { assertSafeS3Endpoint, createSafeS3Client } from "./s3-transport";

const servers: Array<http.Server | https.Server> = [];
const clients: S3Client[] = [];
beforeEach(() => {
	vi.mocked(lookup).mockResolvedValue([{ address: "127.0.0.1", family: 4 }] as never);
	setPrivateEgressAllowedForTests(true);
});
afterEach(async () => {
	for (const client of clients.splice(0)) client.destroy();
	for (const server of servers.splice(0)) {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
	setPrivateEgressAllowedForTests(null);
	vi.clearAllMocks();
});

async function listen(
	handler: (request: IncomingMessage, response: ServerResponse) => void,
	tls?: { key: Buffer; cert: Buffer },
) {
	const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing fixture address");
	return { server, port: address.port };
}
function client(port: number, secure = false, attempts = 1) {
	const value = createSafeS3Client({
		endpoint: `${secure ? "https" : "http"}://storage.fixture.test:${port}`,
		region: "us-east-1",
		forcePathStyle: true,
		maxAttempts: attempts,
		credentials: { accessKeyId: "test-access", secretAccessKey: "test-secret" },
	});
	clients.push(value);
	return value;
}

describe("S3 request and socket egress", () => {
	it.each([
		"http://127.0.0.1:9000",
		"http://localhost:9000",
		"http://minio:9000",
		"http://192.168.1.2:9000",
	])("requires the instance toggle for %s", async (endpoint) => {
		setPrivateEgressAllowedForTests(false);
		await expect(assertSafeS3Endpoint(endpoint)).rejects.toThrow();
		setPrivateEgressAllowedForTests(true);
		await expect(assertSafeS3Endpoint(endpoint)).resolves.toHaveProperty("isPrivate", true);
	});
	it.each([
		"http://nixploy:3000",
		"http://nixploy-postgres:5432",
		"http://10.0.0.4:9000",
		"http://169.254.169.254",
	])("always refuses %s", async (endpoint) => {
		await expect(assertSafeS3Endpoint(endpoint)).rejects.toThrow();
	});
	it("refuses an overlay hidden behind a bare service or DNS hostname", async () => {
		vi.mocked(lookup).mockResolvedValue([{ address: "10.0.0.4", family: 4 }] as never);
		for (const endpoint of ["http://minio:9000", "https://storage.fixture.test"])
			await expect(assertSafeS3Endpoint(endpoint)).rejects.toThrow();
	});
	it("denies a rebind between request validation and the actual socket lookup", async () => {
		let requests = 0;
		const { port } = await listen((_request, response) => {
			requests++;
			response.end("unexpected");
		});
		setPrivateEgressAllowedForTests(false);
		vi.mocked(lookup)
			.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as never)
			.mockResolvedValue([{ address: "169.254.169.254", family: 4 }] as never);
		await expect(
			client(port).send(new ListObjectsV2Command({ Bucket: "fixture" })),
		).rejects.toThrow(/not allowed/);
		expect(requests).toBe(0);
	});
	it("rechecks an existing client's pooled connection after the toggle changes", async () => {
		let requests = 0;
		const { port } = await listen((_request, response) => {
			requests++;
			response.end("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>");
		});
		const s3 = client(port);
		await s3.send(new ListObjectsV2Command({ Bucket: "fixture" }));
		setPrivateEgressAllowedForTests(false);
		await expect(s3.send(new ListObjectsV2Command({ Bucket: "fixture" }))).rejects.toThrow();
		expect(requests).toBe(1);
	});
	it("revalidates the actual target inside SDK retries", async () => {
		let requests = 0;
		const { port } = await listen((_request, response) => {
			requests++;
			setPrivateEgressAllowedForTests(false);
			response.statusCode = 503;
			response.end("<Error><Code>SlowDown</Code></Error>");
		});
		await expect(
			client(port, false, 2).send(new ListObjectsV2Command({ Bucket: "fixture" })),
		).rejects.toThrow(/not allowed|private/i);
		expect(requests).toBe(1);
	});
	it("preserves signed Host/path and Expect:100-continue with pinned agents", async () => {
		let seen: IncomingMessage | undefined;
		let bodyBytes = 0;
		const handler = (request: IncomingMessage, response: ServerResponse) => {
			seen = request;
			request.on("data", (chunk: Buffer) => {
				bodyBytes += chunk.length;
			});
			request.on("end", () => response.end());
		};
		const { server, port } = await listen(handler);
		server.on("checkContinue", (request, response) => {
			response.writeContinue();
			handler(request, response);
		});
		const s3 = client(port);
		s3.middlewareStack.add(
			(next) => async (args) => {
				(args.request as { headers: Record<string, string> }).headers.Expect = "100-continue";
				return next(args);
			},
			{ step: "build", name: "fixtureExpectContinue" },
		);
		await s3.send(
			new PutObjectCommand({ Bucket: "fixture", Key: "folder/a b", Body: Buffer.alloc(1024, 7) }),
		);
		expect(seen?.headers.host).toBe(`storage.fixture.test:${port}`);
		expect(seen?.url).toContain("/fixture/folder/a%20b");
		expect(seen?.headers.authorization).toContain("AWS4-HMAC-SHA256 Credential=test-access/");
		expect(seen?.headers.expect).toBe("100-continue");
		expect(bodyBytes).toBe(1024);
		expect(lookup).toHaveBeenCalledTimes(2);
	});
	it("returns GetObject bytes before the server finishes its response", async () => {
		let finish: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const { port } = await listen((_request, response) => {
			response.setHeader("Content-Length", "10");
			response.write("first");
			void gate.then(() => response.end("later"));
		});
		const result = await client(port).send(
			new GetObjectCommand({ Bucket: "fixture", Key: "stream" }),
		);
		expect(result.Body).toBeInstanceOf(Readable);
		const iterator = (result.Body as Readable)[Symbol.asyncIterator]();
		try {
			expect((await iterator.next()).value.toString()).toBe("first");
		} finally {
			finish();
		}
		let tail = "";
		for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) tail += chunk.toString();
		expect(tail).toBe("later");
	});
	it("keeps multipart signing, part bytes and finalization in the SDK", async () => {
		const actions: string[] = [];
		let partBytes = 0;
		const { port } = await listen((request, response) => {
			const url = new URL(request.url ?? "/", "http://fixture");
			expect(request.headers.authorization).toContain("AWS4-HMAC-SHA256");
			if (request.method === "POST" && url.searchParams.has("uploads")) {
				actions.push("create");
				response.end(
					"<InitiateMultipartUploadResult><UploadId>fixture-upload</UploadId></InitiateMultipartUploadResult>",
				);
				return;
			}
			if (request.method === "PUT") {
				actions.push("part");
				request.on("data", (chunk: Buffer) => {
					partBytes += chunk.length;
				});
				request.on("end", () => {
					response.setHeader("ETag", '"part-etag"');
					response.end();
				});
				return;
			}
			actions.push("complete");
			request.resume();
			request.on("end", () => response.end("<CompleteMultipartUploadResult/>"));
		});
		const s3 = client(port);
		const size = 5 * 1024 * 1024 + 123;
		await uploadStream(
			s3,
			"fixture",
			"large",
			(async function* () {
				yield Buffer.alloc(size, 7);
			})(),
			{ partSizeBytes: 5 * 1024 * 1024 },
		);
		expect(actions).toEqual(["create", "part", "part", "complete"]);
		expect(partBytes).toBe(size);
	});
	it("preserves HTTPS certificate verification and the original SNI hostname", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "nixploy-s3-tls-"));
		try {
			const key = path.join(dir, "key.pem"),
				cert = path.join(dir, "cert.pem");
			execFileSync(
				"openssl",
				[
					"req",
					"-x509",
					"-newkey",
					"rsa:2048",
					"-nodes",
					"-days",
					"1",
					"-subj",
					"/CN=storage.fixture.test",
					"-addext",
					"subjectAltName=DNS:storage.fixture.test",
					"-keyout",
					key,
					"-out",
					cert,
				],
				{ stdio: "ignore" },
			);
			const tls = { key: await readFile(key), cert: await readFile(cert) };
			let sni: string | undefined;
			const { server, port } = await listen(
				(_request, response) => response.end("<ListBucketResult/>"),
				tls,
			);
			server.on("secureConnection", (socket) => {
				sni = socket.servername;
			});
			const s3 = client(port, true);
			await expect(s3.send(new ListObjectsV2Command({ Bucket: "fixture" }))).rejects.toThrow(
				/self.signed|certificate/i,
			);
			const handler = s3.config.requestHandler as unknown as {
				httpHandlerConfigs(): { httpsAgent: https.Agent };
			};
			const agent = handler.httpHandlerConfigs().httpsAgent;
			agent.options.ca = tls.cert;
			await s3.send(new ListObjectsV2Command({ Bucket: "fixture" }));
			expect(sni).toBe("storage.fixture.test");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
