import { describe, expect, it } from "vitest";
import { getDeploymentExplainPath, getDeploymentLogPath } from "../deployment/paths";

describe("deployment explain paths", () => {
	it("maps log paths to sidecar explain json", () => {
		const logPath = getDeploymentLogPath("my-app", "dep_123");
		expect(logPath.endsWith("dep_123.log")).toBe(true);
		expect(getDeploymentExplainPath(logPath)).toBe(logPath.replace(/\.log$/i, ".explain.json"));
	});
});
