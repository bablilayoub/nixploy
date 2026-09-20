import { describe, expect, it } from "vitest";
import { templates } from "./catalog";
import { categoryFromTags, FALLBACK_CATEGORY, TEMPLATE_CATEGORIES } from "./categories";

describe("categoryFromTags", () => {
	it("takes the first tag that maps, in the order the source wrote them", () => {
		// A template tagged media-then-storage is Media; the reverse is Storage.
		expect(categoryFromTags(["media", "storage"])).toBe("Media");
		expect(categoryFromTags(["storage", "media"])).toBe("Storage");
	});

	it("ignores the tags every entry carries", () => {
		// `self-hosted` leads 157 of the 532 public blueprints. If it mapped, it
		// would swallow the tag that actually says what the template is.
		expect(categoryFromTags(["self-hosted", "database"])).toBe("Databases");
		expect(categoryFromTags(["open-source", "monitoring"])).toBe("Monitoring");
	});

	it("normalizes spacing and separators", () => {
		expect(categoryFromTags(["File_Manager"])).toBe("Storage");
		expect(categoryFromTags(["Project Management"])).toBe("Productivity");
		expect(categoryFromTags(["#AI"])).toBe("AI");
	});

	it("falls back rather than inventing a category", () => {
		expect(categoryFromTags([])).toBe(FALLBACK_CATEGORY);
		expect(categoryFromTags(["reef-chain", "something-else"])).toBe(FALLBACK_CATEGORY);
	});

	it("only ever answers with the catalog's own vocabulary", () => {
		const allowed = new Set<string>([...TEMPLATE_CATEGORIES, FALLBACK_CATEGORY]);
		const samples = [
			["llm"],
			["postgres"],
			["uptime"],
			["invoicing"],
			["wireguard"],
			["s3"],
			["kanban"],
			["whatsapp"],
			["docker"],
			["nothing-like-this"],
		];
		for (const tags of samples) {
			expect(allowed.has(categoryFromTags(tags))).toBe(true);
		}
	});

	it("uses the same names the built-in catalog does", () => {
		// The rail merges both sources into one list, so a blueprint tagged
		// `database` has to land in "Databases", not a second "Database" row.
		const built = new Set(templates.map((template) => template.category));
		for (const category of TEMPLATE_CATEGORIES) {
			expect(built.has(category)).toBe(true);
		}
	});
});
