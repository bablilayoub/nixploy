import { describe, expect, it } from "vitest";
import { dedupeImageRows } from "./images";

const row = (over: Partial<Parameters<typeof dedupeImageRows>[0][number]> = {}) => ({
	Repository: "alpine",
	Tag: "3.20",
	ID: "d9e853e87e55",
	Size: "8.3MB",
	CreatedSince: "3 months ago",
	...over,
});

describe("dedupeImageRows", () => {
	it("keeps one row per repository:tag:id (containerd lists one per platform)", () => {
		// Regression: the panel's images table keyed rows on repo:tag:id and
		// React warned about duplicate keys for every multi-arch image.
		const rows = dedupeImageRows([row(), row(), row({ Tag: "3.21", ID: "aaaaaaaaaaaa" })]);
		expect(rows).toHaveLength(2);
		expect(rows.map((r) => r.Tag)).toEqual(["3.20", "3.21"]);
	});

	it("treats a retagged image as a separate row", () => {
		expect(dedupeImageRows([row(), row({ Tag: "latest" })])).toHaveLength(2);
	});
});
