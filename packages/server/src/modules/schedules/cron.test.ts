import { describe, expect, it } from "vitest";
import { isCronExpressionShape, isValidCronExpression } from "./cron";

describe("isValidCronExpression", () => {
	it("accepts 5- and 6-field cron expressions", () => {
		expect(isValidCronExpression("*/5 * * * *")).toBe(true);
		expect(isValidCronExpression("0 3 * * MON-FRI")).toBe(true);
		expect(isValidCronExpression("*/30 * * * * *")).toBe(true);
		expect(isValidCronExpression("  0 0 1 1 *  ")).toBe(true);
	});

	it("accepts cron presets", () => {
		expect(isValidCronExpression("@daily")).toBe(true);
		expect(isValidCronExpression("@hourly")).toBe(true);
	});

	it("rejects date strings node-schedule would turn into one-shot jobs", () => {
		expect(isValidCronExpression("Jan 1 2030")).toBe(false);
		expect(isValidCronExpression("2030-01-01T00:00:00Z")).toBe(false);
		expect(isValidCronExpression("Mon Jan 1 2030 00:00")).toBe(false);
	});

	it("rejects malformed cron", () => {
		expect(isValidCronExpression("")).toBe(false);
		expect(isValidCronExpression("* * * *")).toBe(false);
		expect(isValidCronExpression("* * * * * * *")).toBe(false);
		expect(isValidCronExpression("99 * * * *")).toBe(false);
		expect(isValidCronExpression("* * * * MONDAYISH")).toBe(false);
	});

	it("shape check rejects shell-ish characters", () => {
		expect(isCronExpressionShape("* * * * $(x)")).toBe(false);
		expect(isCronExpressionShape("* * * * *; rm")).toBe(false);
	});
});
