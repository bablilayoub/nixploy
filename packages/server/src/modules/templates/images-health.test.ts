import { describe, expect, it } from "vitest";
import { templates } from "./catalog";
import { checkCatalogImages, extractImagesFromCompose, listCatalogImages } from "./images";

describe("template images", () => {
	it("extractImagesFromCompose handles plain and quoted refs", () => {
		const compose = `
services:
  a:
    image: nginx:1.27
  b:
    image: "supabase/studio:2026.08.03-sha-022b374"
  c:
    image: 'redis:7-alpine' # comment
`;
		expect(extractImagesFromCompose(compose)).toEqual([
			"nginx:1.27",
			"supabase/studio:2026.08.03-sha-022b374",
			"redis:7-alpine",
		]);
	});

	it("listCatalogImages returns unique sorted refs covering every template", () => {
		const images = listCatalogImages();
		expect(images.length).toBeGreaterThan(50);
		expect(images).toEqual([...images].sort());
		expect(new Set(images).size).toBe(images.length);

		for (const template of templates) {
			const fromTemplate = extractImagesFromCompose(template.compose);
			expect(fromTemplate.length, `${template.id} has no images`).toBeGreaterThan(0);
			for (const image of fromTemplate) {
				expect(images).toContain(image);
			}
		}
	});

	it.runIf(process.env.TEMPLATE_IMAGE_CHECK === "1")(
		"every catalog image resolves a registry manifest",
		async () => {
			const results = await checkCatalogImages();
			const failures = results.filter((result) => !result.ok);
			expect(failures, failures.map((f) => `${f.image}: ${f.error}`).join("\n")).toEqual([]);
		},
		120_000,
	);
});
