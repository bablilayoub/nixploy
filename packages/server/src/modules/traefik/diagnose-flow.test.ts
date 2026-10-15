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
	listContainers: vi.fn(),
	inspectService: vi.fn(),
	exec: vi.fn(),
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
vi.mock("../../utils/exec", () => ({ execAsync: boundary.exec }));
vi.mock("../cluster/public-host", () => ({ detectPublicIp: boundary.publicIp }));
vi.mock("../monitoring/platform-alerts", () => ({ readAcmeCertificates: boundary.readAcme }));
vi.mock("../deployment/docker", () => ({
	getDocker: async () => ({
		listTasks: boundary.listTasks,
		getService: (name: string) => ({ inspect: () => boundary.inspectService(name) }),
		getNetwork: () => ({ inspect: async () => ({ Id: "nixploy-network" }) }),
		listContainers: boundary.listContainers,
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
	boundary.exec.mockResolvedValue("");
	boundary.listTasks.mockResolvedValue([{ Status: { State: "running" } }]);
	boundary.inspectService.mockImplementation(async (name: string) => ({
		Spec: {
			Name: name,
			Labels: {
				"com.docker.stack.namespace":
					(boundary.domain.previewDeployment as { appName?: string } | undefined)?.appName ??
					(boundary.domain.compose as { appName?: string } | undefined)?.appName,
			},
			TaskTemplate: { Networks: [{ Target: "nixploy-network" }] },
		},
	}));
	boundary.listContainers.mockResolvedValue([
		{ NetworkSettings: { Networks: { "nixploy-network": {} } } },
	]);
	proxyAnswer(200, "shop");
	await routeFile();
});

describe("domain diagnosis pipeline with external boundaries mocked", () => {
	it("trusts the stored public custom chain independently of Traefik's container path", async () => {
		boundary.domain.certificate = {
			certificateData: "installed-public-chain",
			certificatePath: "/etc/nixploy/traefik/dynamic/certificates/custom.crt",
		};
		await diagnoseDomain("domain-test");
		expect(boundary.request.mock.calls.at(-1)?.[0].ca).toContain("installed-public-chain");
	});
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

	it.each(["shop-pr-7_shop-pr-7-web", "shop-pr-7_web"])(
		"keeps the preview route alias while inspecting physical Swarm service %s",
		async (physical) => {
			delete boundary.domain.application;
			boundary.domain.compose = {
				appName: "shop",
				composeType: "stack",
				isolatedDeployment: true,
				suffix: "production-only",
			};
			boundary.domain.serviceName = "web";
			boundary.domain.previewDeployment = { appName: "shop-pr-7" };
			await routeFile("shop-pr-7_web");
			boundary.inspectService.mockImplementation(async (name: string) => {
				if (name !== physical)
					throw Object.assign(new Error("No such service"), { statusCode: 404 });
				return {
					Spec: {
						Labels: { "com.docker.stack.namespace": "shop-pr-7" },
						TaskTemplate: { Networks: [{ Target: "nixploy-network" }] },
					},
				};
			});
			const result = await diagnoseDomain("domain-test");
			expect(result.findings.find((finding) => finding.id === "file")?.status).toBe("ok");
			expect(boundary.listTasks).toHaveBeenCalledWith({
				filters: { service: [physical], "desired-state": ["running"] },
			});
			expect(boundary.exec).toHaveBeenCalledWith(
				expect.stringContaining("shop-pr-7_web"),
				expect.any(Object),
			);
			expect(boundary.inspectService.mock.calls.flat().join(" ")).not.toContain("production-only");
		},
	);

	it.each([
		{ label: "qualified", suffix: "", physical: "shop_shop-web" },
		{ label: "qualified isolated", suffix: "release1", physical: "shop_shop-web-release1" },
		{ label: "legacy", suffix: "", physical: "shop_web" },
		{ label: "legacy isolated", suffix: "release1", physical: "shop_web-release1" },
	])(
		"diagnoses the $label Stack service without changing its route alias",
		async ({ suffix, physical }) => {
			delete boundary.domain.application;
			boundary.domain.compose = {
				appName: "shop",
				composeType: "stack",
				isolatedDeployment: Boolean(suffix),
				suffix,
			};
			boundary.domain.serviceName = "web";
			await routeFile(`shop_web${suffix ? `-${suffix}` : ""}`);
			boundary.inspectService.mockImplementation(async (name: string) => {
				if (name !== physical)
					throw Object.assign(new Error("No such service"), { statusCode: 404 });
				return {
					Spec: {
						Name: name,
						Labels: { "com.docker.stack.namespace": "shop" },
						TaskTemplate: { Networks: [{ Target: "nixploy-network" }] },
					},
				};
			});
			const result = await diagnoseDomain("domain-test");
			for (const id of ["file", "upstream", "network"])
				expect(result.findings.find((finding) => finding.id === id)?.status).toBe("ok");
			expect(boundary.exec).toHaveBeenCalledWith(
				expect.stringContaining(`shop_web${suffix ? `-${suffix}` : ""}`),
				expect.any(Object),
			);
			expect(boundary.listTasks).toHaveBeenCalledWith({
				filters: { service: [physical], "desired-state": ["running"] },
			});
			expect(boundary.listContainers).not.toHaveBeenCalled();
		},
	);

	it("reports a missing Stack instead of trusting stale task records", async () => {
		delete boundary.domain.application;
		boundary.domain.compose = { appName: "shop", composeType: "stack" };
		boundary.domain.serviceName = "web";
		await routeFile("shop_web");
		boundary.inspectService.mockRejectedValue(
			Object.assign(new Error("No such service"), { statusCode: 404 }),
		);
		const result = await diagnoseDomain("domain-test");
		expect(result.findings.find((finding) => finding.id === "upstream")?.status).toBe("fail");
		expect(result.findings.find((finding) => finding.id === "network")?.status).toBe("skip");
		expect(boundary.listTasks).not.toHaveBeenCalled();
	});

	it("does not mask an unhealthy qualified Stack with a healthy legacy service", async () => {
		delete boundary.domain.application;
		boundary.domain.compose = { appName: "shop", composeType: "stack" };
		boundary.domain.serviceName = "web";
		await routeFile("shop_web");
		boundary.listTasks.mockImplementation(
			async ({ filters }: { filters: { service: string[] } }) =>
				filters.service[0] === "shop_shop-web" ? [] : [{ Status: { State: "running" } }],
		);
		boundary.inspectService.mockImplementation(async (name: string) => ({
			Spec: {
				Name: name,
				Labels: { "com.docker.stack.namespace": "shop" },
				TaskTemplate: { Networks: name === "shop_shop-web" ? [] : [{ Target: "nixploy-network" }] },
			},
		}));
		const result = await diagnoseDomain("domain-test");
		for (const id of ["upstream", "network"])
			expect(result.findings.find((finding) => finding.id === id)?.status).toBe("fail");
		expect(boundary.inspectService.mock.calls.flat()).not.toContain("shop_web");
	});

	it.each(["transport", "foreign namespace"])(
		"does not fall back from a %s error inspecting the qualified Stack",
		async (reason) => {
			delete boundary.domain.application;
			boundary.domain.compose = { appName: "shop", composeType: "stack" };
			boundary.domain.serviceName = "web";
			await routeFile("shop_web");
			boundary.inspectService.mockImplementation(async () => {
				if (reason === "transport")
					throw Object.assign(new Error("Docker unavailable"), { statusCode: 503 });
				return { Spec: { Labels: { "com.docker.stack.namespace": "other-project" } } };
			});
			const result = await diagnoseDomain("domain-test");
			for (const id of ["upstream", "network"])
				expect(result.findings.find((finding) => finding.id === id)?.status).toBe("skip");
			expect(boundary.inspectService.mock.calls.flat()).not.toContain("shop_web");
			expect(boundary.listTasks).not.toHaveBeenCalled();
		},
	);

	it.each([
		{ label: "qualified", suffix: "", deployed: "shop-web" },
		{ label: "qualified isolated", suffix: "release1", deployed: "shop-web-release1" },
		{ label: "legacy", suffix: "", deployed: "web" },
		{ label: "legacy isolated", suffix: "release1", deployed: "web-release1" },
	])(
		"finds $label production Compose containers without broadening project scope",
		async ({ suffix, deployed }) => {
			delete boundary.domain.application;
			boundary.domain.compose = {
				appName: "shop",
				composeType: "docker-compose",
				isolatedDeployment: Boolean(suffix),
				suffix,
			};
			boundary.domain.serviceName = "web";
			const key = `shop-web${suffix ? `-${suffix}` : ""}`;
			await routeFile(key);
			boundary.listContainers.mockImplementation(
				async ({ filters }: { filters: { label: string[] } }) =>
					filters.label.includes(`com.docker.compose.service=${deployed}`)
						? [{ NetworkSettings: { Networks: { "nixploy-network": {} } } }]
						: [],
			);
			const result = await diagnoseDomain("domain-test");
			for (const id of ["file", "upstream", "network"]) {
				expect(result.findings.find((finding) => finding.id === id)?.status).toBe("ok");
			}
			for (const [options] of boundary.listContainers.mock.calls) {
				expect(options.filters.label).toContain("com.docker.compose.project=shop");
				expect(options.filters.label).toHaveLength(2);
			}
		},
	);

	it.each(["shop-pr-7-web", "web"])(
		"finds preview Compose label %s using the preview project without its parent's suffix",
		async (deployed) => {
			delete boundary.domain.application;
			boundary.domain.compose = {
				appName: "shop",
				composeType: "docker-compose",
				isolatedDeployment: true,
				suffix: "production-only",
			};
			boundary.domain.serviceName = "web";
			boundary.domain.previewDeployment = { appName: "shop-pr-7" };
			await routeFile("shop-pr-7-web");
			boundary.listContainers.mockImplementation(
				async ({ filters }: { filters: { label: string[] } }) =>
					filters.label.includes(`com.docker.compose.service=${deployed}`)
						? [{ NetworkSettings: { Networks: { "nixploy-network": {} } } }]
						: [],
			);
			const result = await diagnoseDomain("domain-test");
			for (const id of ["file", "upstream", "network"]) {
				expect(result.findings.find((finding) => finding.id === id)?.status).toBe("ok");
			}
			for (const [options] of boundary.listContainers.mock.calls) {
				expect(options.filters.label).toContain("com.docker.compose.project=shop-pr-7");
				expect(options.filters.label.join(" ")).not.toContain("production-only");
			}
		},
	);

	it("keeps inspecting the qualified deployment when legacy containers also exist", async () => {
		delete boundary.domain.application;
		boundary.domain.compose = { appName: "shop", composeType: "docker-compose" };
		boundary.domain.serviceName = "web";
		await routeFile("shop-web");
		boundary.listContainers.mockImplementation(
			async ({ filters }: { filters: { label: string[] } }) =>
				filters.label.includes("com.docker.compose.service=shop-web")
					? [{ NetworkSettings: { Networks: {} } }]
					: [{ NetworkSettings: { Networks: { "nixploy-network": {} } } }],
		);
		const result = await diagnoseDomain("domain-test");
		expect(result.findings.find((finding) => finding.id === "upstream")?.status).toBe("ok");
		expect(result.findings.find((finding) => finding.id === "network")?.status).toBe("fail");
		for (const [options] of boundary.listContainers.mock.calls) {
			expect(options.filters.label).toContain("com.docker.compose.service=shop-web");
		}
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
