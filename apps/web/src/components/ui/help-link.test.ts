import { describe, expect, it } from "vitest";

import { docsSlugs } from "../../../../landing/src/lib/docs/nav";
import { docsPages } from "../../../../landing/src/lib/docs/pages";
import { DOC_SLUGS, docsUrl } from "./help-link";

/**
 * `<HelpLink slug="…">` links the panel's risky options to nixploy.com/docs,
 * but the pages live in a different workspace package (`@nixploy/landing`) and
 * are deployed separately. TypeScript only checks a slug against `DocSlug`;
 * nothing stopped `DocSlug` itself from naming a page the landing site does
 * not serve, which is a 404 in a "Learn more" link an operator clicked because
 * they were unsure about a dangerous switch.
 *
 * The two packages cannot import each other at runtime (separate Next apps,
 * separate builds), but this test runs with the repo root as its vitest root,
 * so it can read the landing registry directly and pin the three invariants:
 * every help slug is a real page, every page is reachable from the sidebar,
 * and every sidebar entry has a page behind it.
 */
describe("help-link slugs", () => {
	const pageSlugs = new Set(docsPages.map((page) => page.slug));

	it("every DocSlug has a page on the landing site", () => {
		const missing = DOC_SLUGS.filter((slug) => !pageSlugs.has(slug));
		expect(missing, "add these to apps/landing/src/lib/docs/pages.ts").toEqual([]);
	});

	it("every landing page is reachable from the docs sidebar", () => {
		const navSlugs = new Set(docsSlugs);
		const orphans = [...pageSlugs].filter((slug) => !navSlugs.has(slug));
		expect(orphans, "add these to apps/landing/src/lib/docs/nav.ts").toEqual([]);
	});

	it("every docs sidebar entry has a page", () => {
		const dangling = docsSlugs.filter((slug) => !pageSlugs.has(slug));
		expect(dangling, "these nav links would 404").toEqual([]);
	});

	it("builds the public docs URL", () => {
		expect(docsUrl("private-egress")).toBe("https://nixploy.com/docs/private-egress");
		expect(docsUrl()).toBe("https://nixploy.com/docs");
	});
});
