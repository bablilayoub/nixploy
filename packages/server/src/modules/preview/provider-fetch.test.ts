import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setPrivateEgressAllowedForTests } from "../../utils/public-url";
import { providerJsonFetch } from "./provider-fetch";

describe("preview provider requests", () => {
	let server: Server;
	let base: string;
	let requests = 0;
	let redirectedRequests = 0;

	beforeAll(async () => {
		server = createServer((request, response) => {
			requests += 1;
			if (request.url === "/redirect") {
				response.writeHead(302, { location: `${base}/token-leak` });
				response.end();
				return;
			}
			if (request.url === "/token-leak") redirectedRequests += 1;
			response.setHeader("content-type", "application/json");
			response.end(JSON.stringify({ authorization: request.headers.authorization }));
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing server address");
		base = `http://127.0.0.1:${address.port}`;
	});

	afterAll(async () => {
		setPrivateEgressAllowedForTests(null);
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	});

	it("refuses a private provider before sending credentials unless the instance allows it", async () => {
		setPrivateEgressAllowedForTests(false);
		const before = requests;
		await expect(providerJsonFetch(`${base}/status`, { token: "fixture-token" })).rejects.toThrow(
			"private address",
		);
		expect(requests).toBe(before);
	});

	it("supports an approved self-hosted provider with its token scheme", async () => {
		setPrivateEgressAllowedForTests(true);
		await expect(
			providerJsonFetch(`${base}/status`, { token: "fixture-token", tokenScheme: "token" }),
		).resolves.toEqual({ authorization: "token fixture-token" });
	});

	it("does not follow a redirect with the provider credential", async () => {
		setPrivateEgressAllowedForTests(true);
		await expect(providerJsonFetch(`${base}/redirect`, { token: "fixture-token" })).rejects.toThrow(
			"302",
		);
		expect(redirectedRequests).toBe(0);
	});

	it("refuses metadata and cluster targets even when private egress is allowed", async () => {
		setPrivateEgressAllowedForTests(true);
		for (const host of ["169.254.169.254", "10.0.0.8", "nixploy-postgres"]) {
			await expect(
				providerJsonFetch(`http://${host}/status`, { token: "fixture-token" }),
			).rejects.toThrow("not allowed");
		}
	});
});
