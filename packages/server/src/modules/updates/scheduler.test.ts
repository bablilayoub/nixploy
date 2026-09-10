import { describe, expect, it } from "vitest";
import { isValidUpdateCron } from "./scheduler";
import { DEFAULT_CHECK_CRON } from "./settings";

describe("isValidUpdateCron", () => {
	it("accepts 5- and 6-field cron expressions", () => {
		expect(isValidUpdateCron(DEFAULT_CHECK_CRON)).toBe(true);
		expect(isValidUpdateCron("0 3 * * *")).toBe(true);
		expect(isValidUpdateCron("*/30 * * * * *")).toBe(true);
	});

	it("rejects typos, date strings and garbage node-schedule would silently accept", () => {
		expect(isValidUpdateCron("* * * *")).toBe(false);
		expect(isValidUpdateCron("2030-01-01T00:00:00Z")).toBe(false);
		expect(isValidUpdateCron("every 6 hours")).toBe(false);
		expect(isValidUpdateCron("")).toBe(false);
		expect(isValidUpdateCron("99 99 * * *")).toBe(false);
	});
});
