import { describe, expect, it } from "vitest";
import {
	classifyVersionChange,
	compareVersions,
	DATABASE_VERSIONS,
	imageForVersion,
	isCuratedVersion,
	recommendedVersion,
	versionFromImage,
} from "./versions";

describe("DATABASE_VERSIONS", () => {
	it("offers exactly one recommended version per engine", () => {
		for (const [kind, versions] of Object.entries(DATABASE_VERSIONS)) {
			expect(versions.length, kind).toBeGreaterThan(0);
			expect(
				versions.filter((row) => row.recommended),
				kind,
			).toHaveLength(1);
		}
	});

	it("lists versions newest first", () => {
		for (const [kind, versions] of Object.entries(DATABASE_VERSIONS)) {
			for (let i = 1; i < versions.length; i++) {
				expect(
					compareVersions(versions[i - 1]?.version ?? "", versions[i]?.version ?? ""),
					`${kind}: ${versions[i - 1]?.version} should sort after ${versions[i]?.version}`,
				).toBeGreaterThan(0);
			}
		}
	});
});

describe("image mapping", () => {
	it("builds the official tag", () => {
		expect(imageForVersion("postgres", "17")).toBe("postgres:17");
		expect(imageForVersion("mariadb", "11.4")).toBe("mariadb:11.4");
	});

	it("recognises a curated image and ignores custom ones", () => {
		expect(versionFromImage("postgres", "postgres:17")).toBe("17");
		expect(versionFromImage("postgres", "postgres:17-alpine")).toBeNull();
		expect(versionFromImage("postgres", "timescale/timescaledb:2.17-pg17")).toBeNull();
		expect(versionFromImage("mysql", "postgres:17")).toBeNull();
	});

	it("knows which tags are curated", () => {
		expect(isCuratedVersion("mysql", "8.4")).toBe(true);
		expect(isCuratedVersion("mysql", "5.7")).toBe(false);
		expect(recommendedVersion("postgres")).toBe("18");
	});
});

describe("compareVersions", () => {
	it("compares numerically, not lexically", () => {
		expect(compareVersions("9", "8.4")).toBeGreaterThan(0);
		expect(compareVersions("10.11", "11.4")).toBeLessThan(0);
		expect(compareVersions("11.8", "11.4")).toBeGreaterThan(0);
		expect(compareVersions("17", "17")).toBe(0);
	});
});

describe("classifyVersionChange", () => {
	it("is a no-op without a previous version or when unchanged", () => {
		expect(classifyVersionChange("postgres", null, "17")).toEqual({ kind: "none" });
		expect(classifyVersionChange("postgres", "17", "17")).toEqual({ kind: "none" });
	});

	it("blocks a downgrade on every engine whose on-disk format is versioned", () => {
		for (const kind of ["postgres", "mysql", "mariadb", "mongo"] as const) {
			const verdict = classifyVersionChange(
				kind,
				kind === "postgres" ? "17" : "11.8",
				kind === "postgres" ? "16" : "11.4",
			);
			expect(verdict.kind, kind).toBe("blocked");
		}
	});

	it("asks for a backup confirmation on a major upgrade", () => {
		const verdict = classifyVersionChange("postgres", "16", "17");
		expect(verdict.kind).toBe("confirm");
		expect(verdict.kind === "confirm" && verdict.reason).toMatch(/pgdata/i);
	});

	it("allows a bump inside the same major series", () => {
		expect(classifyVersionChange("mariadb", "11.4", "11.8").kind).toBe("allowed");
		expect(classifyVersionChange("mysql", "8.0", "8.4").kind).toBe("allowed");
		// …but crossing the major boundary still asks for a backup.
		expect(classifyVersionChange("mariadb", "10.11", "11.4").kind).toBe("confirm");
		expect(classifyVersionChange("mysql", "8.4", "9").kind).toBe("confirm");
	});

	it("lets redis move in both directions", () => {
		expect(classifyVersionChange("redis", "8", "7.2")).toEqual({ kind: "allowed" });
		expect(classifyVersionChange("redis", "7.2", "8")).toEqual({ kind: "allowed" });
	});
});
