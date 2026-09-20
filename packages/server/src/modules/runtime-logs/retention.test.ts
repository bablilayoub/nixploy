import { describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ db: {} }));
vi.mock("../projects/quotas", () => ({ getOrgQuotas: vi.fn() }));
vi.mock("../services/registry", () => ({ findServiceByAppName: vi.fn() }));

import { getOrgQuotas } from "../projects/quotas";
import { findServiceByAppName } from "../services/registry";
import { effectiveRuntimeLogLimits, runtimeLogLimitsResolver } from "./retention";

const MB = 1024 * 1024;
const instance = { retentionDays: 7, maxBytes: 256 * MB };

describe("effectiveRuntimeLogLimits", () => {
	it("uses the instance ceiling when the org sets nothing", () => {
		expect(
			effectiveRuntimeLogLimits(
				{ runtimeLogRetentionDays: null, runtimeLogMaxMbPerService: null },
				instance,
			),
		).toEqual(instance);
	});
	it("lets an org keep less, never more, than the instance", () => {
		expect(
			effectiveRuntimeLogLimits(
				{ runtimeLogRetentionDays: 2, runtimeLogMaxMbPerService: 32 },
				instance,
			),
		).toEqual({ retentionDays: 2, maxBytes: 32 * MB });
		expect(
			effectiveRuntimeLogLimits(
				{ runtimeLogRetentionDays: 30, runtimeLogMaxMbPerService: 4096 },
				instance,
			),
		).toEqual(instance);
	});
	it("treats 0 as no limit on either side, the ceiling still winning", () => {
		expect(
			effectiveRuntimeLogLimits(
				{ runtimeLogRetentionDays: 0, runtimeLogMaxMbPerService: 0 },
				instance,
			),
		).toEqual(instance);
		expect(
			effectiveRuntimeLogLimits(
				{ runtimeLogRetentionDays: 30, runtimeLogMaxMbPerService: 4096 },
				{ retentionDays: 0, maxBytes: 0 },
			),
		).toEqual({ retentionDays: 30, maxBytes: 4096 * MB });
	});
});

describe("runtimeLogLimitsResolver", () => {
	it("reads each org once and answers the instance limits for an unknown app", async () => {
		process.env.NIXPLOY_RUNTIME_LOG_RETENTION_DAYS = "7";
		process.env.NIXPLOY_RUNTIME_LOG_MAX_MB_PER_SERVICE = "256";
		vi.mocked(findServiceByAppName).mockImplementation(async (appName: string) =>
			appName === "gone"
				? undefined
				: ({ organizationId: appName.startsWith("a-") ? "org-a" : "org-b" } as never),
		);
		vi.mocked(getOrgQuotas).mockImplementation(async (organizationId: string) =>
			organizationId === "org-a"
				? ({ runtimeLogRetentionDays: 1, runtimeLogMaxMbPerService: null } as never)
				: ({ runtimeLogRetentionDays: null, runtimeLogMaxMbPerService: 8 } as never),
		);
		const limitsFor = runtimeLogLimitsResolver();
		expect(await limitsFor("a-shop")).toEqual({ retentionDays: 1, maxBytes: 256 * MB });
		expect(await limitsFor("a-api")).toEqual({ retentionDays: 1, maxBytes: 256 * MB });
		expect(await limitsFor("b-web")).toEqual({ retentionDays: 7, maxBytes: 8 * MB });
		expect(await limitsFor("gone")).toEqual({ retentionDays: 7, maxBytes: 256 * MB });
		expect(vi.mocked(getOrgQuotas)).toHaveBeenCalledTimes(2);
		delete process.env.NIXPLOY_RUNTIME_LOG_RETENTION_DAYS;
		delete process.env.NIXPLOY_RUNTIME_LOG_MAX_MB_PER_SERVICE;
	});
});
