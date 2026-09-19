import { describe, expect, it } from "vitest";
import { describePreviewState, PREVIEW_STATUS_CONTEXT, providerStatusPayload } from "./status";

describe("preview commit statuses", () => {
	const hosts = [{ host: "pr-12-shop.example.dev", https: true }];

	it("describes each state and links to the preview host", () => {
		expect(describePreviewState("pending", hosts)).toEqual({
			state: "pending",
			targetUrl: "https://pr-12-shop.example.dev",
			description: "Nixploy is building the preview",
		});
		expect(describePreviewState("success", hosts).description).toBe(
			"Preview is live at pr-12-shop.example.dev",
		);
		expect(describePreviewState("failure", [])).toEqual({
			state: "failure",
			targetUrl: null,
			description: "Preview build failed",
		});
	});

	it("speaks each provider's dialect", () => {
		const payload = describePreviewState("failure", hosts);
		expect(providerStatusPayload("github", payload)).toEqual({
			state: "failure",
			target_url: "https://pr-12-shop.example.dev",
			description: "Preview build failed",
			context: PREVIEW_STATUS_CONTEXT,
		});
		expect(providerStatusPayload("gitlab", payload)).toMatchObject({
			state: "failed",
			name: PREVIEW_STATUS_CONTEXT,
		});
		expect(
			providerStatusPayload("bitbucket", describePreviewState("pending", hosts)),
		).toMatchObject({ state: "INPROGRESS", key: PREVIEW_STATUS_CONTEXT });
		expect(
			providerStatusPayload("bitbucket", describePreviewState("success", hosts)),
		).toMatchObject({ state: "SUCCESSFUL" });
	});
});
