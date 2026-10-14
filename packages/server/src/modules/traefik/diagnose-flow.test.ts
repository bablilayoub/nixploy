import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";

const boundary = vi.hoisted(() => ({
	domain: {} as Record<string, unknown>,
	files: {} as Record<string, string>,
	request: vi.fn(),
	resolve4: vi.fn(),
	publicIp: vi.fn(),
	readAcme: vi.fn(),
	readFile: vi.fn(),
	listTasks: vi.fn(),
}));

vi.mock("../../db", () => ({
	db: { query: { domains: { findFirst: async () => boundary.domain } } },
}));
vi.mock("node:dns/promises", () => ({
	resolve4: boundary.resolve4,
	resolve6: async () => [],
}));
vi.mock("node:fs/promises", () => ({
	readFile: boundary.readFile,
	readdir: async () => Object.keys(boundary.files),
}));
vi.mock("node:http", () => ({ default: { request: boundary.request } }));
vi.mock("node:https", () => ({ default: { request: boundary.request } }));
vi.mock("../../utils/exec", () => ({ execAsync: vi.fn(async () => ({ stdout: "", stderr: "" })) }));
vi.mock("../cluster/public-host", () => ({ detectPublicIp: boundary.publicIp }));
vi.mock("../monitoring/platform-alerts", () => ({ readAcmeCertificates: boundary.readAcme }));
vi.mock("../deployment/docker", () => ({
	getDocker: async () => ({
		listTasks: boundary.listTasks,
		getService: () => ({
			inspect: async () => ({
				Spec: { TaskTemplate: { Networks: [{ Target: "nixploy-network" }] } },
			}),
		}),
		getNetwork: () => ({ inspect: async () => ({ Id: "nixploy-network" }) }),
		listContainers: async () => [{ NetworkSettings: { Networks: { "nixploy-network": {} } } }],
	}),
}));
vi.mock("./paths", () => ({ getDynamicDir: () => "/test/dynamic" }));

import { buildTraefikFileConfig } from "./config-writer";
import { diagnoseDomain } from "./diagnose";

function proxyAnswer(status: number, body: string, location?: string) {
	boundary.request.mockImplementation(
		(_options: unknown, callback: (response: PassThrough & { statusCode: number }) => void) => {
			const request = Object.assign(new EventEmitter(), {
				end: () => {
					const response = Object.assign(new PassThrough(), {
						statusCode: status,
						headers: { location },
					});
					callback(response);
					response.end(body);
				},
				destroy: (error?: Error) => {
					if (error) request.emit("error", error);
				},
			});
			return request;
		},
	);
}

async function routeFile(key = "shop", host = "shop.example.com", path = "/") {
	boundary.files[`${key}.yml`] = stringify(
		await buildTraefikFileConfig({
			appName: key,
			domains: [{ host, path, port: 80, https: true, certificateType: "none" }],
		}),
	);
}

beforeEach(async () => {
	vi.clearAllMocks();
	boundary.domain = {
		domainId: "domain-test",
		host: "shop.example.com",
		path: "/",
		port: 80,
		protocol: "http",
		tlsMode: "none",
		https: true,
		certificateType: "none",
		application: { appName: "shop" },
	};
	boundary.files = {};
	boundary.readFile.mockImplementation(async (file: string) => {
		const content = boundary.files[file.split("/").at(-1) ?? ""];
		if (content === undefined) throw new Error("ENOENT");
		return content;
	});
	boundary.resolve4.mockResolvedValue(["203.0.113.20"]);
	boundary.publicIp.mockResolvedValue("203.0.113.20");
	boundary.readAcme.mockResolvedValue([]);
	boundary.listTasks.mockResolvedValue([{ Status: { State: "running" } }]);
	proxyAnswer(200, "shop");
	await routeFile();
});

describe("domain diagnosis pipeline with external boundaries mocked", () => {
	it("keeps an application 404 healthy and treats the ambiguous default body as advisory", async () => {
		proxyAnswer(404, "<h1>Product not found</h1>");
		expect((await diagnoseDomain("domain-test")).verdict).toBe("healthy");
		proxyAnswer(404, "404 page not found\n");
		expect((await diagnoseDomain("domain-test")).verdict).toBe("degraded");
	});

	it("limits the sampled 404 body even if the app returns more data", async () => {
		proxyAnswer(404, "x".repeat(64 * 1024));
		const result = await diagnoseDomain("domain-test");
		expect(result.findings.find((finding) => finding.id === "proxy")?.status).toBe("ok");
	});

	it("ends a slowly streaming 404 at the absolute deadline and destroys both transports", async () => {
		vi.useFakeTimers();
		vi.stubEnv("NIXPLOY_TRAEFIK_INTERNAL_HOST", "proxy.test");
		const response = Object.assign(new PassThrough(), { statusCode: 404 });
		const destroyRequest = vi.fn();
		boundary.request.mockImplementation(
			(_options: unknown, callback: (stream: typeof response) => void) =>
				Object.assign(new EventEmitter(), {
					end: () => {
						callback(response);
						// Regular bytes prevent a socket-inactivity timeout, but must
						// not extend the diagnosis's total lifetime.
						const trickle = setInterval(() => response.write("x"), 1_000);
						response.on("close", () => clearInterval(trickle));
					},
					destroy: destroyRequest,
				}),
		);
		try {
			const diagnosis = diagnoseDomain("domain-test");
			await vi.advanceTimersByTimeAsync(8_001);
			const result = await diagnosis;
			expect(result.findings.find((finding) => finding.id === "proxy")).toMatchObject({
				status: "skip",
				detail: "timed out after 8 seconds",
			});
			expect(destroyRequest).toHaveBeenCalledOnce();
			expect(response.destroyed).toBe(true);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			response.destroy();
			vi.useRealTimers();
			vi.unstubAllEnvs();
		}
	});

	it("checks the final proxy answer after a same-host HTTP to HTTPS redirect", async () => {
		boundary.domain.https = false;
		proxyAnswer(502, "Bad Gateway");
		const finalAnswer = boundary.request.getMockImplementation();
		proxyAnswer(308, "", "https://shop.example.com/");
		const redirect = boundary.request.getMockImplementation();
		if (!redirect || !finalAnswer) throw new Error("Missing proxy mock");
		boundary.request.mockImplementationOnce(redirect).mockImplementation(finalAnswer);
		const result = await diagnoseDomain("domain-test");
		expect(result.findings.find((finding) => finding.id === "proxy")?.status).toBe("fail");
		expect(boundary.request).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ hostname: "nixploy-traefik", port: 443 }),
			expect.any(Function),
		);
	});

	it("never follows a redirect to another host", async () => {
		boundary.domain.https = false;
		proxyAnswer(302, "", "https://other.example.com/");
		await diagnoseDomain("domain-test");
		expect(boundary.request).toHaveBeenCalledTimes(1);
	});

	it("checks a wildcard child and recognizes its generated router", async () => {
		boundary.domain.host = "*.apps.example.com";
		await routeFile("shop", "*.apps.example.com");
		boundary.resolve4.mockImplementation(async (host: string) =>
			host.endsWith(".apps.example.com") ? ["203.0.113.20"] : [],
		);
		expect((await diagnoseDomain("domain-test")).verdict).toBe("healthy");
		expect(boundary.resolve4).toHaveBeenCalledWith("nixploy-dns-check.apps.example.com");
	});

	it("allows a second service on a different path while detecting duplicate path claims", async () => {
		await routeFile("api", "shop.example.com", "/api");
		let result = await diagnoseDomain("domain-test");
		expect(result.findings.find((finding) => finding.id === "conflicts")?.status).toBe("ok");
		await routeFile("stale", "shop.example.com", "/");
		result = await diagnoseDomain("domain-test");
		expect(result.findings.find((finding) => finding.id === "conflicts")?.status).toBe("warn");
	});

	it("uses the compose preview's per-service route key and swarm service", async () => {
		delete boundary.domain.application;
		boundary.domain.compose = { appName: "shop", composeType: "stack" };
		boundary.domain.serviceName = "web";
		boundary.domain.previewDeployment = { appName: "shop-pr-7" };
		await routeFile("shop-pr-7_web");
		const result = await diagnoseDomain("domain-test");
		expect(result.findings.find((finding) => finding.id === "file")?.status).toBe("ok");
		expect(boundary.listTasks).toHaveBeenCalledWith({
			filters: { service: ["shop-pr-7_web"], "desired-state": ["running"] },
		});
	});

	it("does not claim DNS points here when the public IP is unavailable", async () => {
		boundary.publicIp.mockResolvedValue(null);
		const result = await diagnoseDomain("domain-test");
		expect(result.findings.find((finding) => finding.id === "dns")?.status).toBe("warn");
	});

	it("reports disabled issuance and expired certificates truthfully", async () => {
		boundary.domain.certificateType = "letsencrypt";
		boundary.domain.https = false;
		let result = await diagnoseDomain("domain-test");
		expect(result.findings.find((finding) => finding.id === "certificate")).toMatchObject({
			status: "warn",
			title: "Let's Encrypt is not enabled for this route",
		});
		expect(boundary.readAcme).not.toHaveBeenCalled();
		boundary.domain.https = true;
		boundary.readAcme.mockResolvedValue([{ domain: "shop.example.com", notAfter: Date.now() - 1 }]);
		result = await diagnoseDomain("domain-test");
		expect(result.findings.find((finding) => finding.id === "certificate")?.status).toBe("fail");
	});

	it("skips unsupported layer-4 file/proxy probes and backend-owned certificates", async () => {
		boundary.domain.protocol = "tcp";
		boundary.domain.tlsMode = "passthrough";
		boundary.domain.certificateType = "letsencrypt";
		const result = await diagnoseDomain("domain-test");
		for (const id of ["file", "conflicts", "port", "proxy", "certificate"]) {
			expect(result.findings.find((finding) => finding.id === id)?.status).toBe("skip");
		}
		expect(boundary.request).not.toHaveBeenCalled();
		expect(boundary.readAcme).not.toHaveBeenCalled();
	});
});
