/**
 * A whole-site audit of the landing app, over every route and four widths.
 *
 * Start the site first (`cd apps/landing && pnpm dev`, or `pnpm build &&
 * pnpm start`), then:
 *
 *   cd tools/screenshots && node audit.mjs           # localhost:3001
 *   BASE=https://nixploy.com node audit.mjs          # anywhere else
 *
 * It prints a JSON array of findings and nothing when the site is clean.
 * What it checks, per route: HTTP status, horizontal overflow (with the
 * offending elements), exactly one `h1`, no skipped heading levels, images
 * with no `alt`, links and buttons with no accessible name, controls under
 * 32px, title / description / canonical / og:title, the `#main-content`
 * landmark, the skip link, console errors — and then every internal link on
 * every page, followed to make sure it answers 200.
 *
 * Its one false positive is "small-targets": it counts inline links in
 * running prose, which WCAG 2.5.8 exempts. Read that number, do not chase it
 * to zero.
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3001";
const ROUTES = [
	"/", "/features", "/pricing", "/templates", "/templates/n8n",
	"/compare", "/nixploy-vs-dokploy", "/agents", "/about", "/privacy",
	"/docs", "/docs/install", "/docs/cli", "/api", "/this-page-does-not-exist",
];
const WIDTHS = [390, 768, 1024, 1440];

const browser = await chromium.launch();
const findings = [];
const add = (route, width, kind, detail) => findings.push({ route, width, kind, detail });

for (const width of WIDTHS) {
	const ctx = await browser.newContext({ viewport: { width, height: 900 } });
	const page = await ctx.newPage();
	const errors = [];
	page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
	page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 160)));

	for (const route of ROUTES) {
		errors.length = 0;
		const res = await page.goto(BASE + route, { waitUntil: "networkidle" }).catch((e) => ({ status: () => `ERR ${e.message.slice(0,60)}` }));
		await page.waitForTimeout(250);
		const status = typeof res?.status === "function" ? res.status() : "?";
		if (status !== 200 && !(route.includes("does-not-exist") && status === 404)) add(route, width, "status", String(status));

		const data = await page.evaluate(() => {
			const docEl = document.documentElement;
			const overflow = docEl.scrollWidth - docEl.clientWidth;
			const offenders = overflow > 1
				? [...document.querySelectorAll("body *")]
					.filter((el) => {
						const r = el.getBoundingClientRect();
						if (r.width === 0) return false;
						if (r.right <= docEl.clientWidth + 1) return false;
						// ignore anything inside a clipping ancestor
						let p = el.parentElement;
						while (p) {
							const ov = getComputedStyle(p).overflowX;
							if (ov === "hidden" || ov === "auto" || ov === "scroll" || ov === "clip") return false;
							p = p.parentElement;
						}
						return true;
					})
					.slice(0, 4)
					.map((el) => `${el.tagName}.${String(el.className).slice(0, 60)}`)
				: [];

			const headings = [...document.querySelectorAll("h1,h2,h3,h4")].map((h) => Number(h.tagName[1]));
			let headingJumps = [];
			for (let i = 1; i < headings.length; i++) {
				if (headings[i] - headings[i - 1] > 1) headingJumps.push(`${headings[i - 1]}->${headings[i]}`);
			}
			const h1Count = document.querySelectorAll("h1").length;

			const imgsNoAlt = [...document.querySelectorAll("img")].filter((i) => i.alt === null || i.alt === undefined).length;
			const linksNoText = [...document.querySelectorAll("a")].filter((a) => {
				const label = (a.getAttribute("aria-label") || a.textContent || "").trim();
				return label.length === 0;
			}).length;
			const buttonsNoText = [...document.querySelectorAll("button")].filter((b) => {
				const label = (b.getAttribute("aria-label") || b.textContent || "").trim();
				return label.length === 0;
			}).length;
			const smallTargets = [...document.querySelectorAll("a,button")].filter((el) => {
				const r = el.getBoundingClientRect();
				return r.width > 0 && r.height > 0 && (r.height < 32 || r.width < 32);
			}).length;

			const title = document.title;
			const desc = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
			const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href") || "";
			const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content") || "";
			const main = document.getElementById("main-content") ? 1 : 0;
			const skip = [...document.querySelectorAll("a")].some((a) => /skip to content/i.test(a.textContent || ""));

			return { overflow, offenders, headingJumps, h1Count, imgsNoAlt, linksNoText, buttonsNoText, smallTargets, title, desc, canonical, ogTitle, main, skip };
		});

		if (data.overflow > 1) add(route, width, "overflow", `${data.overflow}px :: ${data.offenders.join(" | ")}`);
		if (width === 1440) {
			if (data.h1Count !== 1) add(route, width, "h1", `count=${data.h1Count}`);
			if (data.headingJumps.length) add(route, width, "headings", data.headingJumps.join(","));
			if (data.imgsNoAlt) add(route, width, "img-alt", String(data.imgsNoAlt));
			if (data.linksNoText) add(route, width, "link-noname", String(data.linksNoText));
			if (data.buttonsNoText) add(route, width, "button-noname", String(data.buttonsNoText));
			if (data.smallTargets) add(route, width, "small-targets", String(data.smallTargets));
			if (!data.title) add(route, width, "title", "missing");
			if (!data.desc) add(route, width, "description", "missing");
			if (!data.canonical) add(route, width, "canonical", "missing");
			if (!data.ogTitle) add(route, width, "og:title", "missing");
			if (!data.main) add(route, width, "landmark", "no #main-content");
			if (!data.skip) add(route, width, "skip-link", "missing");
		}
		if (errors.length) add(route, width, "console", errors.slice(0, 3).join(" ;; "));
	}
	await ctx.close();
}

// broken internal links, collected from every page at one width
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const seen = new Set();
for (const route of ROUTES.slice(0, 14)) {
	await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
	const hrefs = await page.evaluate(() =>
		[...document.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute("href")),
	);
	for (const h of hrefs) if (h && !h.startsWith("//")) seen.add(h.split("#")[0]);
}
for (const href of [...seen].sort()) {
	if (!href) continue;
	const r = await page.goto(BASE + href, { waitUntil: "domcontentloaded" }).catch(() => null);
	const s = r?.status();
	if (s !== 200) add(href, 1280, "broken-link", String(s));
}
await browser.close();
console.log(JSON.stringify(findings, null, 1));
