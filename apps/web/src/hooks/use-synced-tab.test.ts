import { describe, expect, it } from "vitest";

import { resolveTabParam, SERVICE_TAB_ALIASES } from "@/hooks/use-synced-tab";

const TOP_TABS = ["general", "deploy", "runtime", "environment"];
const isValid = (value: string) => TOP_TABS.includes(value);

describe("resolveTabParam", () => {
	it("falls back to the default when the param is absent", () => {
		expect(resolveTabParam(null, "general", isValid)).toBe("general");
		expect(resolveTabParam("", "general", isValid)).toBe("general");
	});

	it("keeps a valid param", () => {
		expect(resolveTabParam("runtime", "general", isValid)).toBe("runtime");
	});

	it("rejects an unknown param", () => {
		expect(resolveTabParam("does-not-exist", "general", isValid)).toBe("general");
	});

	it("accepts any param when no validator is given", () => {
		expect(resolveTabParam("anything", "general")).toBe("anything");
	});

	it("rewrites retired tab ids before validating", () => {
		expect(resolveTabParam("config", "general", isValid, SERVICE_TAB_ALIASES)).toBe("environment");
		// The alias target still has to be valid for this page.
		expect(
			resolveTabParam("config", "general", (value) => value === "general", SERVICE_TAB_ALIASES),
		).toBe("general");
		// An alias that is not registered is left alone.
		expect(resolveTabParam("deploy", "general", isValid, SERVICE_TAB_ALIASES)).toBe("deploy");
	});
});
