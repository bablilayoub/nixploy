import { mkdtemp, readFile, rm } from "node:fs/promises";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execAsync } from "../../utils/exec";
import { shellQuote } from "../deployment/paths";
import { interpretProxyAnswer, proxyRequest, proxyTlsOptions } from "./diagnose";

let dir: string;
let defaultCertificate: string;
let otherCertificate: string;
let defaultKey: string;
let otherKey: string;
beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "nixploy-diagnostic-tls-"));
	for (const [name, cn] of [
		["default", "nixploy"],
		["other", "shop.example.com"],
	]) {
		await execAsync(
			`openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj ${shellQuote(`/CN=${cn}`)} -keyout ${shellQuote(join(dir, `${name}.key`))} -out ${shellQuote(join(dir, `${name}.crt`))}`,
		);
	}
	[defaultCertificate, otherCertificate, defaultKey, otherKey] = await Promise.all([
		readFile(join(dir, "default.crt"), "utf8"),
		readFile(join(dir, "other.crt"), "utf8"),
		readFile(join(dir, "default.key"), "utf8"),
		readFile(join(dir, "other.key"), "utf8"),
	]);
}, 15_000);
afterAll(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
});

async function withServer(
	cert: string,
	key: string,
	check: (port: number) => Promise<void>,
): Promise<void> {
	const server = https.createServer({ cert, key }, (_request, response) => response.end("ok"));
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("No TLS listener");
		await check(address.port);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
}
const probe = (
	port: number,
	options: ReturnType<typeof proxyTlsOptions>,
	host = "shop.example.com",
) =>
	proxyRequest({
		hostname: "127.0.0.1",
		port,
		tls: true,
		hostHeader: host,
		path: "/",
		tlsOptions: options,
	});

describe("verified internal routing TLS", () => {
	it("trusts only the installed default leaf despite its generic hostname", async () => {
		await withServer(defaultCertificate, defaultKey, async (port) => {
			expect(await probe(port, proxyTlsOptions(defaultCertificate))).toMatchObject({ status: 200 });
			await expect(probe(port, proxyTlsOptions())).rejects.toThrow(/self.signed/i);
		});
	});
	it("rejects another self-signed peer even if its hostname is right", async () => {
		await withServer(otherCertificate, otherKey, async (port) => {
			await expect(probe(port, proxyTlsOptions(defaultCertificate))).rejects.toThrow(
				/self.signed/i,
			);
		});
	});
	it("trusts an explicitly installed custom chain and still checks its hostname", async () => {
		await withServer(otherCertificate, otherKey, async (port) => {
			const options = proxyTlsOptions(defaultCertificate, otherCertificate);
			expect(await probe(port, options)).toMatchObject({ status: 200 });
			await expect(probe(port, options, "wrong.example.com")).rejects.toThrow(/hostname|altnames/i);
		});
	});
	it("reports TLS failure without claiming the workload is unreachable", () => {
		expect(interpretProxyAnswer(null, "certificate has expired")).toMatchObject({
			status: "warn",
			title: "TLS verification prevented the routing probe",
		});
	});
});
