import { describe, expect, it } from "vitest";
import { resolveUpdateCandidate } from "./candidate";

const tracked = "ghcr.io/bablilayoub/nixploy:v0.2.1";

describe("resolveUpdateCandidate", () => {
	it("offers the newest release for a version-pinned install", () => {
		// Regression: the checker compared the digest of the pinned :v0.2.1 tag
		// with itself and reported "up to date" while v0.2.2 was out.
		expect(
			resolveUpdateCandidate({
				trackedImage: tracked,
				latestReleaseTag: "v0.2.2",
				pinnedVersion: null,
			}),
		).toEqual({
			image: "ghcr.io/bablilayoub/nixploy:v0.2.2",
			tag: "v0.2.2",
			reason: "newer-release",
		});
	});

	it("keeps the tracked tag when it is the newest release or GitHub is unknown", () => {
		expect(
			resolveUpdateCandidate({
				trackedImage: tracked,
				latestReleaseTag: "v0.2.1",
				pinnedVersion: null,
			}).image,
		).toBe(tracked);
		expect(
			resolveUpdateCandidate({
				trackedImage: tracked,
				latestReleaseTag: "v0.1.9",
				pinnedVersion: null,
			}).image,
		).toBe(tracked);
		expect(
			resolveUpdateCandidate({ trackedImage: tracked, latestReleaseTag: null, pinnedVersion: null })
				.reason,
		).toBe("current-release");
	});

	it("leaves moving tags to the digest comparison", () => {
		expect(
			resolveUpdateCandidate({
				trackedImage: "ghcr.io/bablilayoub/nixploy:latest",
				latestReleaseTag: "v9.0.0",
				pinnedVersion: null,
			}),
		).toEqual({ image: "ghcr.io/bablilayoub/nixploy:latest", tag: null, reason: "moving-tag" });
	});

	it("never offers a release past the pin", () => {
		expect(
			resolveUpdateCandidate({
				trackedImage: tracked,
				latestReleaseTag: "v0.3.0",
				pinnedVersion: "0.2.2",
			}),
		).toEqual({
			image: "ghcr.io/bablilayoub/nixploy:v0.2.2",
			tag: "v0.2.2",
			reason: "capped-by-pin",
		});
		expect(
			resolveUpdateCandidate({
				trackedImage: tracked,
				latestReleaseTag: "v0.3.0",
				pinnedVersion: "0.2.1",
			}).image,
		).toBe(tracked);
	});
});
