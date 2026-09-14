import { describe, expect, it } from "vitest";
import { resolveUpdateCandidate } from "./candidate";
import { adoptRunningImage } from "./check";

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

describe("adoptRunningImage", () => {
	it("adopts the tag the service actually runs", () => {
		// Regression: `update.sh` rolled the service to v0.2.3 while the panel's
		// stored tracked image stayed v0.2.1, so the update dialog offered to
		// pull v0.2.1 — a downgrade.
		expect(adoptRunningImage(tracked, "ghcr.io/bablilayoub/nixploy:v0.2.3")).toBe(
			"ghcr.io/bablilayoub/nixploy:v0.2.3",
		);
	});

	it("drops a digest suffix and ignores an unchanged or missing ref", () => {
		expect(adoptRunningImage(tracked, "ghcr.io/bablilayoub/nixploy:v0.2.3@sha256:abc")).toBe(
			"ghcr.io/bablilayoub/nixploy:v0.2.3",
		);
		expect(adoptRunningImage(tracked, tracked)).toBeNull();
		expect(adoptRunningImage(tracked, null)).toBeNull();
	});

	it("never adopts across repositories", () => {
		expect(adoptRunningImage(tracked, "docker.io/someoneelse/nixploy:v9.9.9")).toBeNull();
	});
});
