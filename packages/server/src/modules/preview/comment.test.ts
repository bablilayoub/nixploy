import { describe, expect, it } from "vitest";
import { PREVIEW_COMMENT_MARKER, renderPreviewComment } from "./comment";

describe("renderPreviewComment", () => {
	it("carries the marker so repeat pushes edit one comment", () => {
		const body = renderPreviewComment({
			pullRequestNumber: "42",
			hosts: ["pr-42-my-app.traefik.me"],
			status: "deploying",
		});
		expect(body.startsWith(PREVIEW_COMMENT_MARKER)).toBe(true);
	});

	it("links the preview host and the pull request", () => {
		const body = renderPreviewComment({
			pullRequestNumber: "42",
			hosts: ["pr-42-my-app.traefik.me"],
			status: "deploying",
		});
		expect(body).toContain("https://pr-42-my-app.traefik.me");
		expect(body).toContain("#42");
	});

	it("states the preview is gone once it is torn down", () => {
		const body = renderPreviewComment({
			pullRequestNumber: "7",
			hosts: ["pr-7-my-app.traefik.me"],
			status: "removed",
		});
		expect(body).toContain(PREVIEW_COMMENT_MARKER);
		expect(body).toContain("torn down");
		expect(body).not.toContain("https://pr-7-my-app.traefik.me");
	});
});
