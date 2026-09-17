import { describe, expect, it } from "vitest";
import { deploymentIdFrom } from "./wait-deployment.js";

describe("deploymentIdFrom", () => {
	it("reads the id out of what a deploy verb returns", () => {
		expect(deploymentIdFrom({ applicationId: "app_1", deploymentId: "dep_1" })).toBe("dep_1");
	});

	it("returns null for anything that queued nothing", () => {
		for (const payload of [
			null,
			undefined,
			{},
			{ deploymentId: "" },
			{ deploymentId: 7 },
			"dep_1",
		]) {
			expect(deploymentIdFrom(payload)).toBeNull();
		}
	});
});
