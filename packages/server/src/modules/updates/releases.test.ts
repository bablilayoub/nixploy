import { describe, expect, it } from "vitest";
import {
	assertVersionAllowed,
	autoUpdateAllowed,
	compareVersions,
	imageVersionTag,
	MAX_RELEASE_NOTES_BYTES,
	parseVersion,
	releaseTag,
	truncateNotes,
	withImageTag,
} from "./releases";

describe("parseVersion", () => {
	it("accepts x.y.z with and without a leading v", () => {
		expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
		expect(parseVersion("v0.10.0")).toEqual({ major: 0, minor: 10, patch: 0 });
		expect(parseVersion("  v2.0.1 ")).toEqual({ major: 2, minor: 0, patch: 1 });
	});

	it("rejects anything that is not a plain release", () => {
		for (const value of [
			"latest",
			"1.2",
			"1.2.3.4",
			"1.2.3-rc.1",
			"v1.2.3+build",
			"",
			"../../etc/passwd",
			"1.2.3; rm -rf /",
		]) {
			expect(parseVersion(value), value).toBeNull();
		}
	});
});

describe("compareVersions", () => {
	it("orders by major, then minor, then patch", () => {
		expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
		expect(compareVersions("1.3.0", "1.2.9")).toBe(1);
		expect(compareVersions("1.2.3", "v1.2.3")).toBe(0);
		expect(compareVersions("0.9.10", "0.9.9")).toBe(1);
	});

	it("treats unparseable versions as equal rather than guessing", () => {
		expect(compareVersions("latest", "1.0.0")).toBe(0);
	});
});

describe("releaseTag", () => {
	it("canonicalizes to a v-prefixed tag", () => {
		expect(releaseTag("1.2.3")).toBe("v1.2.3");
		expect(releaseTag("v1.2.3")).toBe("v1.2.3");
	});

	it("refuses anything that could reach a URL path or a shell", () => {
		expect(() => releaseTag("latest")).toThrow(/Invalid version/);
		expect(() => releaseTag("../../../evil")).toThrow(/Invalid version/);
	});
});

describe("imageVersionTag / withImageTag", () => {
	it("reads the tag off a ref, ignoring the digest", () => {
		expect(imageVersionTag("ghcr.io/bablilayoub/nixploy:v0.2.0")).toBe("v0.2.0");
		expect(imageVersionTag("ghcr.io/bablilayoub/nixploy:v0.2.0@sha256:abc")).toBe("v0.2.0");
		expect(imageVersionTag("ghcr.io/bablilayoub/nixploy")).toBe("");
	});

	it("re-tags without touching the registry or repository", () => {
		expect(withImageTag("ghcr.io/bablilayoub/nixploy:latest", "v1.2.3")).toBe(
			"ghcr.io/bablilayoub/nixploy:v1.2.3",
		);
		// A port in the registry host must not be mistaken for the tag.
		expect(withImageTag("registry.example.com:5000/team/app:latest", "v9.9.9")).toBe(
			"registry.example.com:5000/team/app:v9.9.9",
		);
		expect(withImageTag("ghcr.io/x/nixploy:v1.0.0@sha256:deadbeef", "v1.0.1")).toBe(
			"ghcr.io/x/nixploy:v1.0.1",
		);
	});
});

describe("truncateNotes", () => {
	it("leaves a body under the cap untouched", () => {
		const body = "## What's new\n\n- one\n- two\n";
		expect(truncateNotes(body)).toEqual({ notes: body, truncated: false });
	});

	it("cuts at a line break and marks the result truncated", () => {
		const body = `${"line of release notes\n".repeat(40)}`;
		const { notes, truncated } = truncateNotes(body, 100);
		expect(truncated).toBe(true);
		expect(Buffer.byteLength(notes, "utf8")).toBeLessThanOrEqual(100 + 5);
		expect(notes.endsWith("…")).toBe(true);
		// Never mid-line: the last kept line is whole.
		expect(notes.split("\n")[0]).toBe("line of release notes");
	});

	it("budgets BYTES, so multi-byte characters cannot slip past the cap", () => {
		// 200 four-byte emoji = 800 bytes but only 400 UTF-16 code units.
		const body = "🚀".repeat(200);
		const { notes, truncated } = truncateNotes(body, 100);
		expect(truncated).toBe(true);
		expect(Buffer.byteLength(notes, "utf8")).toBeLessThanOrEqual(105);
	});

	it("defaults to the 16 kB cap", () => {
		const { truncated } = truncateNotes("x".repeat(MAX_RELEASE_NOTES_BYTES + 1));
		expect(truncated).toBe(true);
	});
});

describe("assertVersionAllowed", () => {
	it("allows an upgrade", () => {
		expect(assertVersionAllowed({ currentVersion: "1.0.0", targetVersion: "1.1.0" })).toEqual({
			isDowngrade: false,
		});
	});

	it("refuses a downgrade unless it is acknowledged", () => {
		expect(() => assertVersionAllowed({ currentVersion: "1.2.0", targetVersion: "1.1.0" })).toThrow(
			/migrations are not reversed/i,
		);
		expect(
			assertVersionAllowed({
				currentVersion: "1.2.0",
				targetVersion: "1.1.0",
				allowDowngrade: true,
			}),
		).toEqual({ isDowngrade: true });
	});

	it("refuses a target beyond the pin", () => {
		expect(() =>
			assertVersionAllowed({
				currentVersion: "1.0.0",
				targetVersion: "2.0.0",
				pinnedVersion: "1.5.0",
			}),
		).toThrow(/pinned to v1\.5\.0/);
		// Exactly the pin is fine.
		expect(
			assertVersionAllowed({
				currentVersion: "1.0.0",
				targetVersion: "1.5.0",
				pinnedVersion: "1.5.0",
			}),
		).toEqual({ isDowngrade: false });
	});

	it("rejects a malformed target before anything else", () => {
		expect(() =>
			assertVersionAllowed({ currentVersion: "1.0.0", targetVersion: "latest" }),
		).toThrow(/Invalid version/);
	});
});

describe("autoUpdateAllowed", () => {
	it("is unrestricted without a pin", () => {
		expect(autoUpdateAllowed("v2.0.0", null)).toBe(true);
	});

	it("holds back a candidate newer than the pin", () => {
		expect(autoUpdateAllowed("v2.0.0", "1.5.0")).toBe(false);
		expect(autoUpdateAllowed("v1.4.0", "1.5.0")).toBe(true);
		expect(autoUpdateAllowed("v1.5.0", "1.5.0")).toBe(true);
	});

	it("never holds back what it cannot compare", () => {
		// A digest-only `:latest` build has no version to weigh against the pin.
		expect(autoUpdateAllowed(null, "1.5.0")).toBe(true);
		expect(autoUpdateAllowed("latest", "1.5.0")).toBe(true);
	});
});
