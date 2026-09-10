import { describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ db: {} }));
vi.mock("../application/service", () => ({
	createApplication: vi.fn(),
	syncApplicationTraefik: vi.fn(),
	updateApplication: vi.fn(),
}));
vi.mock("../compose/service", () => ({
	createCompose: vi.fn(),
	resyncComposeDomains: vi.fn(),
	saveComposeFile: vi.fn(),
	updateComposeById: vi.fn(),
}));
vi.mock("../projects", () => ({ getEnvironmentServices: vi.fn() }));
vi.mock("../databases/engine", () => ({
	DATABASE_CONFIGS: {},
	generateDatabaseAppName: (name: string) => `${name}-abc123`,
}));

import { domainUpdatePatch } from "./apply";
import type { GitopsDomain } from "./schema";

/** The zod output type carries `path` as an always-present key (transform). */
const domain = (fields: Omit<GitopsDomain, "path"> & { path?: string }): GitopsDomain => ({
	path: undefined,
	...fields,
});

describe("domainUpdatePatch", () => {
	it("leaves omitted fields alone instead of resetting https/certificateType", () => {
		// `domains: [{host}]` against a live letsencrypt domain must be a no-op.
		expect(domainUpdatePatch(domain({ host: "a.example.com" }), { applicationId: "app1" })).toEqual(
			{},
		);
	});

	it("patches only the fields the manifest defines", () => {
		expect(
			domainUpdatePatch(
				domain({ host: "a.example.com", https: true, certificateType: "letsencrypt" }),
				{ applicationId: "app1" },
			),
		).toEqual({ https: true, certificateType: "letsencrypt" });
	});

	it("never writes serviceName on application domains, only on compose domains", () => {
		const withService = domain({ host: "a.example.com", serviceName: "web" });
		expect(domainUpdatePatch(withService, { applicationId: "app1" })).toEqual({});
		expect(domainUpdatePatch(withService, { composeId: "c1" })).toEqual({ serviceName: "web" });
		expect(
			domainUpdatePatch(domain({ host: "a.example.com", serviceName: null }), { composeId: "c1" }),
		).toEqual({ serviceName: null });
	});

	it("validates compose service names", () => {
		expect(() =>
			domainUpdatePatch(domain({ host: "a.example.com", serviceName: "bad name" }), {
				composeId: "c1",
			}),
		).toThrow(/Invalid compose service name/);
	});
});
