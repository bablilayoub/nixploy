import { describe, expect, it } from "vitest";
import { LITE_PROFILE, liteProfileEnabled, NORMAL_PROFILE, profileDefaults } from "./profile";

describe("liteProfileEnabled", () => {
	it("accepts 1 and true, ignores everything else", () => {
		for (const value of ["1", "true", "TRUE", " true "]) {
			expect(liteProfileEnabled({ NIXPLOY_LITE: value })).toBe(true);
		}
		for (const value of ["0", "false", "yes", "", undefined]) {
			expect(liteProfileEnabled({ NIXPLOY_LITE: value })).toBe(false);
		}
		expect(liteProfileEnabled({})).toBe(false);
	});
});

describe("profileDefaults", () => {
	it("hands back the profile the environment asks for", () => {
		expect(profileDefaults({})).toBe(NORMAL_PROFILE);
		expect(profileDefaults({ NIXPLOY_LITE: "1" })).toBe(LITE_PROFILE);
	});
	it("keeps the lite profile smaller than the normal one on every knob", () => {
		expect(LITE_PROFILE.runtimeLogs).toBe(false);
		expect(LITE_PROFILE.metricsRetentionHours).toBeLessThan(NORMAL_PROFILE.metricsRetentionHours);
		expect(LITE_PROFILE.runtimeLogRetentionDays).toBeLessThan(
			NORMAL_PROFILE.runtimeLogRetentionDays,
		);
		expect(LITE_PROFILE.runtimeLogMaxMbPerService).toBeLessThan(
			NORMAL_PROFILE.runtimeLogMaxMbPerService,
		);
		expect(LITE_PROFILE.sshMaxChannels).toBeLessThan(NORMAL_PROFILE.sshMaxChannels);
		// Both crons stay valid six-field node-schedule expressions.
		for (const cron of [LITE_PROFILE.metricsSampleCron, LITE_PROFILE.uptimeProbeCron]) {
			expect(cron.split(" ")).toHaveLength(6);
		}
	});
});
